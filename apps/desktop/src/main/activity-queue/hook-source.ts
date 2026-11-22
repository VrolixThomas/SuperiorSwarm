import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type {
	ActivityQueueItem,
	ActivityQueueSource,
	ExternalQueueItem,
} from "../../shared/activity-queue";
import type { QueueHookOutput, QueueHookProjectStatus } from "../../shared/queue-hooks";
import { getDb } from "../db";
import { appSettings, projects } from "../db/schema";
import { activityQueueSources } from "../db/schema-activity-queue";
import { projectTint } from "./describe-workspace-item";
import { hookIntervalMs, parseQueueHookOutput, readQueueHookConfig } from "./hook-config";
import { runQueueHook } from "./hook-process";
import { ActivityQueueService } from "./service";

const ENABLED = "queueProjectHooks.enabled";
const errorKey = (id: string, hookId?: string) =>
	`queueProjectHooks.error.${JSON.stringify([id, hookId ?? null])}`;
const trustKey = (id: string) => `queueProjectHooks.trust.${id}`;
const runningRoots = new Set<string>();
const runtime = { active: new Map<string, AbortController>(), due: new Map<string, number>() };

function setting(key: string): string | undefined {
	return getDb().select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
}
function writeSetting(key: string, value: string) {
	getDb()
		.insert(appSettings)
		.values({ key, value })
		.onConflictDoUpdate({ target: appSettings.key, set: { value } })
		.run();
}
export function projectHooksEnabled(): boolean {
	return setting(ENABLED) === "true";
}
export function setProjectHooksEnabled(enabled: boolean) {
	writeSetting(ENABLED, String(enabled));
	if (!enabled) for (const controller of runtime.active.values()) controller.abort();
}
export function listProjectHookStatus(): QueueHookProjectStatus[] {
	return getDb()
		.select()
		.from(projects)
		.all()
		.map((project) => {
			try {
				const config = readQueueHookConfig(project.repoPath);
				return {
					projectId: project.id,
					projectName: project.name,
					root: config.root,
					hash: config.hash,
					configText: config.text,
					hooks: config.hooks,
					trusted: setting(trustKey(project.id)) === config.hash,
					error:
						setting(errorKey(project.id)) ||
						config.hooks.map((hook) => setting(errorKey(project.id, hook.id))).find(Boolean) ||
						null,
				};
			} catch (error) {
				return {
					projectId: project.id,
					projectName: project.name,
					root: project.repoPath,
					hash: null,
					configText: null,
					hooks: [],
					trusted: false,
					error:
						(error as NodeJS.ErrnoException).code === "ENOENT"
							? null
							: "Could not read a valid queue hook configuration.",
				};
			}
		});
}
export function trustProjectHooks(projectId: string, hash: string) {
	const status = listProjectHookStatus().find((item) => item.projectId === projectId);
	if (!status?.hash || status.hash !== hash)
		throw new Error("Hook configuration changed. Review it again before trusting.");
	writeSetting(trustKey(projectId), hash);
	for (const key of runtime.due.keys()) {
		if (key.startsWith(`${projectId}:`)) runtime.due.delete(key);
	}
}
export function revokeProjectHookTrust(projectId: string) {
	writeSetting(trustKey(projectId), "");
	runtime.active.get(projectId)?.abort();
}
export function projectHookSourceId(projectId: string, hookId: string, key: string): string {
	return `hook:${[projectId, hookId, key].map(encodeURIComponent).join(":")}`;
}
interface HookSnapshot {
	projectId: string;
	hookId: string;
	root: string;
	configHash: string;
	output: QueueHookOutput;
}
function hookSnapshot(source: ActivityQueueSource): HookSnapshot | null {
	const value = source.snapshot as Partial<HookSnapshot> | null;
	return value &&
		typeof value.projectId === "string" &&
		typeof value.hookId === "string" &&
		typeof value.root === "string" &&
		typeof value.configHash === "string" &&
		value.output
		? (value as HookSnapshot)
		: null;
}
function sourcesForProject(id: string) {
	return getDb()
		.select()
		.from(activityQueueSources)
		.where(eq(activityQueueSources.sourceType, "project-hook"))
		.all()
		.filter((source) => hookSnapshot(source)?.projectId === id);
}

/** Whole-output validation precedes a single transaction; partial output cannot resolve keys. */
export function reconcileProjectHookOutput(
	project: { id: string; name: string },
	config: { root: string; hash: string },
	hook: { id: string; title: string },
	rows: QueueHookOutput[],
	observedAt = Date.now()
) {
	const db = getDb();
	db.transaction(() => {
		const queue = new ActivityQueueService(db);
		const seen = new Set<string>();
		for (const row of rows) {
			const sourceId = projectHookSourceId(project.id, hook.id, row.key);
			seen.add(sourceId);
			const fingerprint = createHash("sha256")
				.update(
					JSON.stringify([
						row.key,
						row.title,
						row.why,
						row.severity ?? null,
						row.url ?? null,
						row.fixPrompt ?? null,
					])
				)
				.digest("hex");
			queue.observe({
				sourceId,
				sourceType: "project-hook",
				observedAt,
				fingerprint,
				snapshot: {
					projectId: project.id,
					hookId: hook.id,
					root: config.root,
					configHash: config.hash,
					output: row,
				},
				candidate: {
					kind: "project-hook",
					title: row.title,
					summary: row.why,
					projectId: project.id,
					projectName: project.name,
					occurredAt: observedAt,
					reasons: [
						{ code: "project-hook", label: hook.title },
						...(row.severity ? [{ code: "severity", label: row.severity }] : []),
					],
					target: {
						type: "project-hook",
						projectId: project.id,
						hookId: hook.id,
						key: row.key,
						url: row.url,
						fixPrompt: row.fixPrompt,
					},
				},
			});
		}
		for (const old of sourcesForProject(project.id)) {
			if (hookSnapshot(old)?.hookId === hook.id && !seen.has(old.sourceId))
				queue.resolve(old.sourceId, observedAt);
		}
	});
}

export async function refreshProjectHookQueue(projectId?: string, force = false): Promise<void> {
	if (!projectHooksEnabled()) return;
	for (const status of listProjectHookStatus()) {
		if (projectId && projectId !== status.projectId) continue;
		if (runtime.active.has(status.projectId) || runningRoots.has(status.root)) continue;
		const queue = new ActivityQueueService();

		const unavailable = (error: string, hookId?: string) => {
			writeSetting(errorKey(status.projectId, hookId), error);
			writeSetting(`${errorKey(status.projectId)}.time`, String(Date.now()));
			for (const source of sourcesForProject(status.projectId)) {
				if (!hookId || hookSnapshot(source)?.hookId === hookId)
					queue.markUnavailable(source.sourceId, error);
			}
		};
		if (!status.hash || !status.trusted) {
			unavailable(
				status.hash
					? "Review and trust this project's current hook configuration in Settings."
					: (status.error ?? "Hook configuration is unavailable. Previous results were retained.")
			);
			continue;
		}
		writeSetting(errorKey(status.projectId), "");
		const controller = new AbortController();
		runtime.active.set(status.projectId, controller);
		runningRoots.add(status.root);

		try {
			for (const hook of status.hooks) {
				if (controller.signal.aborted || !projectHooksEnabled()) break;
				const scheduleKey = `${status.projectId}:${status.hash}:${hook.id}`;
				if (!force && (runtime.due.get(scheduleKey) ?? 0) > Date.now()) continue;
				runtime.due.set(scheduleKey, Date.now() + hookIntervalMs(hook));
				const current = listProjectHookStatus().find(
					(value) => value.projectId === status.projectId
				);
				if (!current?.trusted || current.hash !== status.hash || current.root !== status.root) {
					unavailable("Hook configuration changed. Review trust again.");
					break;
				}

				const result = await runQueueHook(hook.run, status.root, controller.signal);
				const after = listProjectHookStatus().find((value) => value.projectId === status.projectId);
				if (
					controller.signal.aborted ||
					!projectHooksEnabled() ||
					!after?.trusted ||
					after.hash !== status.hash ||
					after.root !== status.root
				) {
					unavailable("Hook configuration or trust changed during the run.");
					break;
				}
				if (!result.ok) {
					unavailable(result.error, hook.id);
					continue;
				}
				try {
					const rows = parseQueueHookOutput(result.stdout);
					reconcileProjectHookOutput(
						{ id: status.projectId, name: status.projectName },
						{ root: status.root, hash: status.hash },
						hook,
						rows
					);
					writeSetting(errorKey(status.projectId, hook.id), "");
				} catch {
					unavailable("Hook returned invalid or incomplete JSON lines.", hook.id);
				}
			}
			const current = listProjectHookStatus().find((value) => value.projectId === status.projectId);
			if (
				!controller.signal.aborted &&
				projectHooksEnabled() &&
				current?.trusted &&
				current.hash === status.hash
			) {
				// An explicitly re-trusted complete config can retire deleted hook definitions.
				const activeHooks = new Set(status.hooks.map((hook) => hook.id));
				for (const source of sourcesForProject(status.projectId)) {
					const snapshot = hookSnapshot(source);
					if (snapshot && !activeHooks.has(snapshot.hookId)) queue.resolve(source.sourceId);
				}
			}
		} finally {
			runtime.active.delete(status.projectId);
			runningRoots.delete(status.root);
		}
	}
}

/** Project-level checks aggregate once; all orchestrators/workspaces reference that same project. */
export function isProjectHookQueueItemCurrent(item: ActivityQueueItem): boolean {
	if (!projectHooksEnabled() || item.target.type !== "project-hook") return false;
	return Boolean(
		getDb()
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.id, item.target.projectId))
			.get()
	);
}

export function describeProjectHookQueueItem(item: ActivityQueueItem): ExternalQueueItem | null {
	if (item.target.type !== "project-hook" || !isProjectHookQueueItemCurrent(item)) return null;
	const project = getDb()
		.select()
		.from(projects)
		.where(eq(projects.id, item.target.projectId))
		.get();
	return {
		...item,
		category: "hooks",
		situation: "project-hook",
		subject: item.title,
		why: item.summary,
		clearsWhen:
			"Clears when a successful check no longer reports it, or you mark this revision Done.",
		sourceLabel:
			item.reasons.find((reason) => reason.code === "project-hook")?.label ?? "Project check",
		nextAction: item.target.fixPrompt
			? "Review the evidence, then open the project or choose an agent fix."
			: "Review the evidence and address the project check.",
		openLabel: item.target.url ? "Open evidence" : "Open project",
		detailLabel: "Check evidence",
		evidence: [item.summary],
		context: {
			projectId: item.target.projectId,
			projectName: project?.name ?? item.projectName ?? "Project",
			projectTint: projectTint(item.target.projectId),
			projectColor: project?.color,
		},
	};
}

export function getProjectHookQueueErrors() {
	if (!projectHooksEnabled()) return [];
	return listProjectHookStatus().flatMap((status) =>
		status.error
			? [
					{
						sourceId: `hook-config:${encodeURIComponent(status.projectId)}`,
						error: `${status.projectName}: ${status.error}`,
						observedAt: Number(setting(`${errorKey(status.projectId)}.time`)) || 0,
					},
				]
			: []
	);
}

export function initializeProjectHookQueue(): () => void {
	const timer = setInterval(() => {
		void refreshProjectHookQueue().catch(() => {});
	}, 15_000);
	timer.unref();
	return () => {
		clearInterval(timer);
		for (const controller of runtime.active.values()) controller.abort();
	};
}
