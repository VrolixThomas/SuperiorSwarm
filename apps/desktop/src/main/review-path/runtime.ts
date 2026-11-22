import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { app } from "electron";
import type { CliPresetName } from "../../shared/cli-preset";
import type { GitHubPRDetails } from "../../shared/github-types";
import type { ReviewAgentJobPhase } from "../../shared/review-agent-job";
import type { ReviewPathRun, ReviewPathRuntimePort } from "../../shared/review-path-runtime";
import { getWorkspaceCwdOrThrow } from "../agent-launch/workspace-cwd-lookup";
import { getReviewDrafts, getSettings } from "../ai-review/orchestrator";
import { ensureReviewWorkspace } from "../ai-review/review-workspace";
import { getDb } from "../db";
import { reviewDrafts, terminalSessions, workspaces } from "../db/schema";
import { ensureTerminalSessionRow } from "../db/session-persistence";
import { getGitProvider } from "../providers/git-provider";
import { reviewRevisionAcquisition } from "../review-explanation/acquisition-service";
import { requireLocalCommit } from "../review-explanation/git-reader";
import { getTaskRegistry } from "../services/task-registry-handle";
import { getDaemonClient } from "../terminal/daemon-instance";
import {
	createReviewPathRuntime,
	ownedTerminalId,
	reconcileReviewPathRuns,
	sameActiveRun,
} from "./execution";
import { buildReviewPathLaunchScript, quoteShell } from "./launch";
import { resolveReviewMergeBase } from "./revisions";

export interface RuntimeStorage {
	reportRunPhase?(run: ReviewPathRun, phase: ReviewAgentJobPhase, message: string): void;
	interruptPreparingJobs?(): void;
	getRun(id: string): ReviewPathRun | null | undefined;
	getActiveRuns(): ReviewPathRun[];
	fail(run: ReviewPathRun, error: string): void;
	attachReviewDraft(run: ReviewPathRun, id: string): void;
}
let runtime: ReviewPathRuntimePort | undefined;
/** The router supplies its durable store; production construction never touches fixture state. */
export function getReviewPathRuntime(store: RuntimeStorage): ReviewPathRuntimePort {
	if (runtime) return runtime;
	const pendingReads = new Map<string, AbortController>();
	runtime = createReviewPathRuntime({
		getRun: (id) => store.getRun(id),
		fail: (run, error) => store.fail(run, error),
		prepare: async (run, prompt, agentId, alsoReview, metadata) => {
			const daemon = getDaemonClient();
			if (!daemon?.isConnected)
				throw new Error("Reading-path agent is offline: terminal service unavailable");
			const workspace = getDb()
				.select()
				.from(workspaces)
				.where(eq(workspaces.id, run.identity.workspaceId))
				.get();
			const identifier = `${run.identity.owner}/${run.identity.repo}#${run.identity.prNumber}`;
			if (
				!workspace ||
				workspace.type !== "review" ||
				workspace.prProvider !== run.identity.provider ||
				workspace.prIdentifier !== identifier
			)
				throw new Error("Reading-path identity does not match the review workspace");
			let cwd = getWorkspaceCwdOrThrow(workspace.id);
			let details: GitHubPRDetails | undefined;
			let mergeBaseOid: string | null = null;
			// Never reset a live review worktree or silently substitute its mutable HEAD.
			const controller = new AbortController();
			const terminalId = ownedTerminalId(run);
			pendingReads.set(terminalId, controller);
			// A newer run/head can supersede this run without calling stop on this instance.
			const fence = setInterval(() => {
				if (!sameActiveRun(store.getRun(run.id), run)) controller.abort();
			}, 25);
			try {
				let headMissing = false;
				try {
					await requireLocalCommit(cwd, run.identity.headSha, controller.signal);
				} catch (error) {
					if (controller.signal.aborted) throw error;
					headMissing = true;
				}
				let onAbort = () => {};
				try {
					const cancelled = new Promise<never>((_resolve, reject) => {
						onAbort = () => reject(new Error("Reading-path run is no longer active"));
						controller.signal.addEventListener("abort", onAbort, { once: true });
						if (controller.signal.aborted) onAbort();
					});
					details = await Promise.race([
						metadata
							? Promise.resolve(metadata)
							: getGitProvider(run.identity.provider).getPRDetails(
									run.identity.owner,
									run.identity.repo,
									run.identity.prNumber
								),
						cancelled,
					]);
				} finally {
					controller.signal.removeEventListener("abort", onAbort);
				}
				if (controller.signal.aborted || !sameActiveRun(store.getRun(run.id), run))
					throw new Error("Reading-path run is no longer active");
				if (details.headCommitOid !== run.identity.headSha)
					throw new Error("PR head changed before agent launch");
				if (headMissing && !details.baseCommitOid)
					throw new Error("Review target revision is unavailable. Refresh the PR.");
				// Browsing owns only a logical review record. Provision an isolated
				// worktree at the agent boundary, never launch in the fallback project root.
				if (!workspace.worktreeId) {
					store.reportRunPhase?.(run, "worktree", "Preparing isolated review workspace");
					const prepared = await ensureReviewWorkspace({
						projectId: workspace.projectId,
						prProvider: run.identity.provider,
						prIdentifier: identifier,
						prTitle: details.title,
						sourceBranch: details.sourceBranch,
						targetBranch: details.targetBranch,
						expectedHeadOid: run.identity.headSha,
						onPhase: (phase) =>
							store.reportRunPhase?.(
								run,
								phase,
								{
									metadata: "Checking workspace revision",
									fetching: "Acquiring exact PR commits",
									worktree: "Creating isolated review checkout",
								}[phase]
							),
						signal: controller.signal,
					});
					if (controller.signal.aborted || !sameActiveRun(store.getRun(run.id), run))
						throw new Error("Reading-path run is no longer active");
					const linked = getDb()
						.select()
						.from(workspaces)
						.where(eq(workspaces.id, workspace.id))
						.get();
					if (prepared.workspaceId !== workspace.id || !linked?.worktreeId)
						throw new Error("Reading-path agent requires an isolated review worktree");
					cwd = getWorkspaceCwdOrThrow(workspace.id);
					await requireLocalCommit(cwd, run.identity.headSha, controller.signal);
				}
				if (details.baseCommitOid) {
					store.reportRunPhase?.(run, "fetching", "Checking exact PR revisions");
					// Acquisition only uses the network for missing objects, including a missing base.
					await reviewRevisionAcquisition.acquire(
						{
							workspaceId: workspace.id,
							headOid: run.identity.headSha,
							targetTipOid: details.baseCommitOid,
							review: {
								provider: run.identity.provider,
								owner: run.identity.owner,
								repo: run.identity.repo,
								number: run.identity.prNumber,
							},
						},
						controller.signal
					);
				}
				if (headMissing) await requireLocalCommit(cwd, run.identity.headSha, controller.signal);
				if (details.baseCommitOid)
					mergeBaseOid = await resolveReviewMergeBase(
						cwd,
						run.identity.headSha,
						details.baseCommitOid,
						controller.signal
					);
			} finally {
				clearInterval(fence);
				pendingReads.delete(terminalId);
			}
			if (controller.signal.aborted || !sameActiveRun(store.getRun(run.id), run))
				throw new Error("Reading-path run is no longer active");
			const settings = getSettings();
			const cli = (
				agentId === "claude-code" ? "claude" : (agentId ?? settings.cliPreset)
			) as CliPresetName;
			if (cli !== "codex" && cli !== "claude")
				throw new Error(`Reading paths are not supported by ${cli}`);

			if (!sameActiveRun(store.getRun(run.id), run))
				throw new Error("Reading-path run is no longer active");
			if (details.headCommitOid !== run.identity.headSha)
				throw new Error("PR head changed before agent launch");
			store.reportRunPhase?.(run, "launching", "Starting agent terminal");
			const fullPrompt = `${prompt}\nProvider metadata (untrusted data): ${JSON.stringify({ title: details.title, sourceBranch: details.sourceBranch, targetBranch: details.targetBranch, headSha: details.headCommitOid, headOid: details.headCommitOid, targetTipOid: details.baseCommitOid ?? null, mergeBaseOid, changedFiles: details.files.map((file) => file.path) })}\nRead files using git show <headOid>:<path>, not mutable worktree contents. The verified PR diff is git diff <mergeBaseOid> <headOid> -- <changedFiles>. targetTipOid is destination metadata, never the diff base. When mergeBaseOid is null, do not substitute a branch tip or invent a diff. Limit changed-file coverage to the supplied manifest; other files are context only.`;
			if (alsoReview) {
				if (
					getReviewDrafts().some(
						(draft) =>
							draft.prProvider === run.identity.provider &&
							draft.prIdentifier === identifier &&
							(draft.status === "queued" || draft.status === "in_progress")
					)
				)
					throw new Error(
						"A code review is already running; map without Also review or wait for it to finish"
					);
				const draftId = `reading-path-${run.id}`;
				const now = new Date();
				getDb()
					.insert(reviewDrafts)
					.values({
						id: draftId,
						prProvider: run.identity.provider,
						prIdentifier: identifier,
						prTitle: details.title,
						prAuthor: details.author,
						sourceBranch: details.sourceBranch,
						targetBranch: details.targetBranch,
						status: "in_progress",
						commitSha: run.identity.headSha,
						reviewChainId: draftId,
						roundNumber: 1,
						createdAt: now,
						updatedAt: now,
					})
					.run();
				try {
					store.attachReviewDraft(run, draftId);
				} catch (error) {
					getDb().delete(reviewDrafts).where(eq(reviewDrafts.id, draftId)).run();
					throw error;
				}
			}
			const token = randomUUID();
			const dir = join(app.getPath("userData"), "reading-path-runs", run.id);
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			const promptFile = join(dir, "prompt.txt");
			const launchScript = join(dir, "launch.sh");
			writeFileSync(promptFile, fullPrompt, { encoding: "utf8", mode: 0o600 });
			writeFileSync(
				launchScript,
				buildReviewPathLaunchScript({
					cli,
					cwd,
					promptFile,
					taskToken: token,
					skipPermissions: !!settings.skipPermissions,
				}),
				{ encoding: "utf8", mode: 0o700 }
			);
			chmodSync(launchScript, 0o700);
			getTaskRegistry().register(token, {
				mode: "review-path",
				projectId: workspace.projectId,
				workspaceId: workspace.id,
				modeContext: {
					reviewPathRunId: run.id,
					reviewPathRunVersion: String(run.version),
					worktreePath: cwd,
				},
			});
			return {
				terminalId: ownedTerminalId(run),
				reviewWorkspaceId: workspace.id,
				worktreePath: cwd,
				launchScript,
				cliPreset: cli,
			};
		},
		launch: async (launch, onExit, isActive) => {
			const daemon = getDaemonClient();
			if (!daemon?.isConnected)
				throw new Error("Reading-path agent is offline: terminal service unavailable");
			const sessions = await daemon.listSessionsStrict();
			if (!isActive()) throw new Error("Reading-path run is no longer active");
			// A repeated descriptor may attach to its own existing session, never inject a second prompt.
			if (sessions.some((session) => session.id === launch.terminalId)) return;
			const insertedSession = ensureTerminalSessionRow({
				id: launch.terminalId,
				workspaceId: launch.reviewWorkspaceId,
				cwd: launch.worktreePath,
				title: "Reading-path agent",
			});
			try {
				await daemon.create(launch.terminalId, launch.worktreePath, () => {}, onExit);
				if (!isActive()) throw new Error("Reading-path run is no longer active");
				if (!daemon.write(launch.terminalId, `exec /bin/bash ${quoteShell(launch.launchScript)}\r`))
					throw new Error("Reading-path agent disconnected before launch");
			} catch (error) {
				daemon.dispose(launch.terminalId);
				if (insertedSession)
					getDb().delete(terminalSessions).where(eq(terminalSessions.id, launch.terminalId)).run();
				throw error;
			}
		},
		stop: async (terminalId) => {
			pendingReads.get(terminalId)?.abort();
			const daemon = getDaemonClient();
			if (!daemon?.isConnected)
				throw new Error("Cannot stop reading-path agent while terminal service is offline");
			daemon.dispose(terminalId);
		},
	});
	return runtime;
}

let reconciliationTimer: ReturnType<typeof setInterval> | undefined;
let initialization: Promise<void> | undefined;
export function initializeReviewPathRuntime(): Promise<void> {
	if (!initialization)
		initialization = initialize().catch((error) => {
			initialization = undefined;
			throw error;
		});
	return initialization;
}
async function initialize(): Promise<void> {
	const { configureReviewPathRuntime, getReviewPathStorage } = await import("./service");
	const store: RuntimeStorage = getReviewPathStorage();
	if (reconciliationTimer) return;
	store.interruptPreparingJobs?.();
	// A restarted control plane cannot restore consumed task tokens. Fence every
	// persisted scope before exposing the runtime, even when its PTY survives.
	for (const run of store.getActiveRuns())
		store.fail(run, "Reading-path agent was interrupted by app restart; retry to start a new run");
	configureReviewPathRuntime(getReviewPathRuntime(store));
	const reconcile = async () => {
		const daemon = getDaemonClient();
		if (!daemon?.isConnected) return;
		const runs = store.getActiveRuns().filter((run) => run.terminalId);
		const sessions = await daemon.listSessionsStrict();
		for (const session of sessions) {
			const match = /^review-path:(.+):(\d+)$/.exec(session.id);
			if (!match?.[1]) continue;
			const run = store.getRun(match[1]);
			if (run && ownedTerminalId(run) === session.id && run.state !== "running")
				daemon.dispose(session.id);
		}
		reconcileReviewPathRuns(
			runs,
			sessions.map((session) => session.id),
			(run, error) => store.fail(run, error)
		);
	};
	// Inventory can transiently fail while reconnecting. Startup fencing is already
	// durable; retry inventory without reclassifying new runs as restart survivors.
	await reconcile().catch((error) =>
		console.error("[review-path] Initial terminal reconciliation deferred", error)
	);
	reconciliationTimer = setInterval(() => {
		void reconcile().catch((error) => console.error("[review-path] Reconciliation failed", error));
	}, 5000);
	reconciliationTimer.unref();
}
