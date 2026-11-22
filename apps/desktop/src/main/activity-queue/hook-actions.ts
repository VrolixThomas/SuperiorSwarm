import { eq } from "drizzle-orm";
import { CLI_PRESET_NAMES, type CliPresetName } from "../../shared/cli-preset";
import { getWorkspaceCwdOrThrow } from "../agent-launch/workspace-cwd-lookup";
import { requestConfirm } from "../control-plane/confirm-bridge";
import { getDb } from "../db";
import { aiReviewSettings, workspaces } from "../db/schema";
import { dispatchAgent } from "../services/workspace-service";
import { isProjectHookQueueItemCurrent, listProjectHookStatus } from "./hook-source";
import { ActivityQueueService } from "./service";

export function exactProjectHook(input: { id: string; revision: number }) {
	const source = new ActivityQueueService().read(input.id);
	if (
		!source?.candidate ||
		source.revision !== input.revision ||
		source.candidate.target.type !== "project-hook"
	)
		throw new Error("This check changed. Refresh the queue.");
	const item = {
		...source.candidate,
		id: source.sourceId,
		revision: source.revision,
		acknowledged: source.acknowledgedRevision === source.revision,
		stale: Boolean(source.error),
	};
	if (!isProjectHookQueueItemCurrent(item))
		throw new Error("This project check is no longer available.");
	return { source, target: source.candidate.target };
}

export function projectHookFixTargets(input: { id: string; revision: number }) {
	const { target } = exactProjectHook(input);
	const status = listProjectHookStatus().find((project) => project.projectId === target.projectId);
	if (!status?.trusted || !target.fixPrompt) return [];
	return getDb()
		.select()
		.from(workspaces)
		.where(eq(workspaces.projectId, target.projectId))
		.all()
		.filter((workspace) => {
			try {
				return getWorkspaceCwdOrThrow(workspace.id) === status.root;
			} catch {
				return false;
			}
		})
		.map((workspace) => ({ id: workspace.id, name: workspace.name }));
}

const pending = new Set<string>();
export async function fixProjectHook(
	input: { id: string; revision: number; workspaceId: string },
	deps = { confirm: requestConfirm, dispatch: dispatchAgent }
) {
	if (pending.has(input.id)) throw new Error("A fix launch is already awaiting confirmation.");
	pending.add(input.id);
	try {
		const { source, target } = exactProjectHook(input);
		const status = listProjectHookStatus().find(
			(project) => project.projectId === target.projectId
		);
		const snapshot = source.snapshot as { configHash?: string; root?: string };
		const workspace = projectHookFixTargets(input).find((value) => value.id === input.workspaceId);
		if (
			!workspace ||
			!target.fixPrompt ||
			!status?.trusted ||
			status.hash !== snapshot.configHash ||
			status.root !== snapshot.root ||
			source.error
		)
			throw new Error(
				"Refresh this check and select an existing workspace in its project root before fixing."
			);
		const configured =
			getDb().select().from(aiReviewSettings).where(eq(aiReviewSettings.id, "default")).get()
				?.cliPreset ?? "claude";
		if (!CLI_PRESET_NAMES.includes(configured as CliPresetName))
			throw new Error("Configure a supported default agent first.");
		const allowed = await deps.confirm({
			kind: "dispatch",
			workspaceName: workspace.name,
			branch: null,
			summary: `Run ${configured} for ${source.candidate?.title} in ${status.root}. Prompt:\n${target.fixPrompt}`,
		});
		if (!allowed) return { status: "cancelled" as const };
		const fresh = exactProjectHook(input);
		const current = listProjectHookStatus().find(
			(project) => project.projectId === target.projectId
		);
		if (
			fresh.source.error ||
			!current?.trusted ||
			current.hash !== status.hash ||
			current.root !== status.root ||
			!projectHookFixTargets(input).some((value) => value.id === input.workspaceId)
		)
			throw new Error("Check or project changed during confirmation. Refresh before retrying.");
		await deps.dispatch({
			projectId: target.projectId,
			workspaceId: input.workspaceId,
			cliPreset: configured as CliPresetName,
			prompt: target.fixPrompt,
			skipPermissions: false,
		});
		// Launching is not resolution; the next complete hook run owns cleanup.
		return { status: "started" as const };
	} finally {
		pending.delete(input.id);
	}
}
