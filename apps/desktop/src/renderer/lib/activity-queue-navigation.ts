import type { ActivityQueueTarget } from "../../shared/activity-queue";
import type { DaemonAPI } from "../../shared/types";
import { usePaneStore } from "../stores/pane-store";
import { useProjectStore } from "../stores/projects";
import { useReviewModeStore } from "../stores/review-mode-store";
import { useTabStore } from "../stores/tab-store";
import { trpcVanilla } from "../trpc/client";

// Dependency injection exercises the real navigation with a read/mutation API fixture.
export interface QueueNavigationApi {
	workspaces: Pick<typeof trpcVanilla.workspaces, "getById" | "getOrCreateReview">;
	projects: Pick<typeof trpcVanilla.projects, "getByRepo" | "getPRDetails">;
	agentSessions: Pick<typeof trpcVanilla.agentSessions, "list">;
	daemon: Pick<DaemonAPI, "listSessions">;
}
export type QueueDestination = { workspaceId: string; terminalId?: string };
const openingPRs = new Map<string, Promise<QueueDestination>>();
const navigationApi: QueueNavigationApi = {
	workspaces: trpcVanilla.workspaces,
	projects: trpcVanilla.projects,
	agentSessions: trpcVanilla.agentSessions,
	daemon: { listSessions: () => window.electron.daemon.listSessions() },
};

/** Existing layouts remount their terminals. Refuse stale tabs before that can recreate a shell. */
async function requireExistingTerminals(
	workspaceId: string,
	review: boolean,
	api: QueueNavigationApi
): Promise<void> {
	const reviewTerminal = useReviewModeStore.getState().terminals[workspaceId];
	const ids = review
		? reviewTerminal
			? [reviewTerminal.tabId]
			: []
		: useTabStore
				.getState()
				.getTabsByWorkspace(workspaceId)
				.filter((tab) => tab.kind === "terminal")
				.map((tab) => tab.id);
	if (ids.length === 0) return;
	let live: Awaited<ReturnType<DaemonAPI["listSessions"]>>;
	try {
		live = await api.daemon.listSessions();
	} catch {
		throw new Error(
			"Existing terminals could not be verified. Reconnect the terminal service and retry."
		);
	}
	const existing = new Set(live.daemonSessions.map((session) => session.id));
	if (ids.some((id) => !existing.has(id))) {
		throw new Error(
			"A terminal in this workspace is no longer running. Open the workspace explicitly to restore it."
		);
	}
}

async function resolveWorkspace(workspaceId: string, api: QueueNavigationApi) {
	const record = await api.workspaces.getById.query({ id: workspaceId });
	if (!record) throw new Error("This workspace is no longer available.");
	if (!record.path) throw new Error("The workspace directory is no longer available.");
	if (record.type === "review" && (!record.prProvider || !record.prIdentifier))
		throw new Error("The review workspace context is unavailable.");
	return record;
}

function activateWorkspace(workspace: Awaited<ReturnType<typeof resolveWorkspace>>) {
	const store = useTabStore.getState();
	store.setWorkspaceMetadata(workspace.id, {
		// Preserve richer review metadata while validating identity against the current workspace.
		...store.workspaceMetadata[workspace.id],
		type: workspace.type,
		prProvider: workspace.prProvider ?? undefined,
		prIdentifier: workspace.prIdentifier ?? undefined,
	});
	store.navigateToWorkspace(workspace.id, workspace.path);
	useProjectStore.getState().closeSettings();
}

/** Open is navigation only. There is deliberately no acknowledgment API in this helper. */
export async function openQueueTarget(
	target: ActivityQueueTarget,
	api: QueueNavigationApi = navigationApi
): Promise<QueueDestination> {
	if (target.type === "unavailable") throw new Error(target.reason);
	if (target.type === "hermes")
		throw new Error(
			"This Hermes conversation cannot be located safely yet. Open it from Agents using its profile and session."
		);
	if (target.type === "pr") {
		const identifier = `${target.owner}/${target.repo}#${target.number}`;
		const key = `${target.provider}:${identifier}`;
		const pending = openingPRs.get(key);
		if (pending) return pending;
		const opening = (async () => {
			const matches = await api.projects.getByRepo.query({
				owner: target.owner,
				repo: target.repo,
			});
			const projects = matches.filter(
				(p) => p.remoteHost === (target.provider === "github" ? "github.com" : "bitbucket.org")
			);
			const project = target.projectId
				? projects.find((p) => p.id === target.projectId)
				: projects.length === 1
					? projects[0]
					: undefined;
			if (!project)
				throw new Error(
					projects.length > 1
						? "Multiple local projects match this PR. Open it from PRs to choose a project."
						: "This PR repository is not available in a local project."
				);
			const details =
				!target.sourceBranch || !target.targetBranch
					? await api.projects.getPRDetails.query({
							provider: target.provider,
							owner: target.owner,
							repo: target.repo,
							number: target.number,
						})
					: null;
			const sourceBranch = target.sourceBranch || details?.sourceBranch;
			const targetBranch = target.targetBranch || details?.targetBranch;
			if (!sourceBranch || !targetBranch)
				throw new Error("PR branch details are unavailable. Retry when the provider is available.");
			const workspace = await api.workspaces.getOrCreateReview.mutate({
				projectId: project.id,
				prProvider: target.provider,
				prIdentifier: identifier,
				prTitle: target.title ?? details?.title ?? identifier,
				sourceBranch,
				targetBranch,
			});
			const cwd = workspace.worktreePath ?? project.repoPath;
			await requireExistingTerminals(workspace.id, true, api);
			useTabStore.getState().activateReviewWorkspace(workspace.id, cwd, {
				provider: target.provider,
				owner: target.owner,
				repo: target.repo,
				number: target.number,
				title: target.title ?? details?.title ?? identifier,
				sourceBranch,
				targetBranch,
				repoPath: cwd,
			});
			useProjectStore.getState().closeSettings();
			return { workspaceId: workspace.id };
		})();
		openingPRs.set(key, opening);
		try {
			return await opening;
		} finally {
			if (openingPRs.get(key) === opening) openingPRs.delete(key);
		}
	}
	const workspace = await resolveWorkspace(target.workspaceId, api);
	if (target.type === "terminal") {
		const sessions = await api.agentSessions.list.query();
		const session = sessions.find(
			(s) => s.terminalId === target.terminalId && s.workspaceId === target.workspaceId
		);
		if (
			!session ||
			session.provider !== target.provider ||
			(target.providerSessionId !== null && session.providerSessionId !== target.providerSessionId)
		)
			throw new Error(
				"This terminal no longer matches the agent session that requested attention."
			);
		if (session.state === "hibernated" || session.state === "hibernating")
			throw new Error(
				"This agent is asleep. Resume it explicitly from its workspace before opening this terminal."
			);
		const pane = usePaneStore.getState().findPaneForTab(target.workspaceId, target.terminalId);
		const tab = pane?.tabs.find((t) => t.id === target.terminalId && t.kind === "terminal");
		const review = useReviewModeStore.getState().terminals[target.workspaceId];
		if (!tab && review?.tabId !== target.terminalId)
			throw new Error(
				"This terminal is no longer open. Queue will not create a replacement shell."
			);
		if (workspace.type === "review" && review?.tabId !== target.terminalId)
			throw new Error("This terminal is not attached to the review drawer.");
		await requireExistingTerminals(workspace.id, workspace.type === "review", api);
		activateWorkspace(workspace);
		if (workspace.type === "review") {
			const reviewStore = useReviewModeStore.getState();
			if (reviewStore.view !== "terminal") reviewStore.setDrawerOpen(true);
		} else useTabStore.getState().setActiveTab(target.terminalId);
		return { workspaceId: target.workspaceId, terminalId: target.terminalId };
	}
	await requireExistingTerminals(workspace.id, workspace.type === "review", api);
	activateWorkspace(workspace);
	return { workspaceId: target.workspaceId };
}

/** Run after the panel closes and React commits the selected destination. */
export function focusQueueDestination(destination: QueueDestination): void {
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			const hosts = Array.from(document.querySelectorAll<HTMLElement>("[data-queue-workspace]"));
			const host = hosts.find((el) => el.dataset["queueWorkspace"] === destination.workspaceId);
			const terminal = destination.terminalId
				? Array.from(document.querySelectorAll<HTMLElement>("[data-terminal-id]")).find(
						(el) => el.dataset["terminalId"] === destination.terminalId
					)
				: host;
			const input = destination.terminalId
				? terminal?.querySelector<HTMLElement>(".xterm-helper-textarea")
				: null;
			(input ?? host)?.focus();
		})
	);
}
