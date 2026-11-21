import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { app } from "electron";
import type { CliPresetName } from "../../shared/cli-preset";
import type { ReviewPathRun, ReviewPathRuntimePort } from "../../shared/review-path-runtime";
import { getWorkspaceCwdOrThrow } from "../agent-launch/workspace-cwd-lookup";
import { getReviewDrafts, getSettings } from "../ai-review/orchestrator";
import { getDb } from "../db";
import { reviewDrafts, workspaces } from "../db/schema";
import { ensureTerminalSessionRow } from "../db/session-persistence";
import { getGitProvider } from "../providers/git-provider";
import { getTaskRegistry } from "../services/task-registry-handle";
import { getDaemonClient } from "../terminal/daemon-instance";
import { createReviewPathRuntime, ownedTerminalId, reconcileReviewPathRuns } from "./execution";
import { buildReviewPathLaunchScript, quoteShell } from "./launch";

export interface RuntimeStorage {
	getRun(id: string): ReviewPathRun | null | undefined;
	getActiveRuns(): ReviewPathRun[];
	fail(run: ReviewPathRun, error: string): void;
	attachReviewDraft(run: ReviewPathRun, id: string): void;
}
let runtime: ReviewPathRuntimePort | undefined;
/** The router supplies its durable store; production construction never touches fixture state. */
export function getReviewPathRuntime(store: RuntimeStorage): ReviewPathRuntimePort {
	if (runtime) return runtime;
	runtime = createReviewPathRuntime({
		getRun: (id) => store.getRun(id),
		fail: (run, error) => store.fail(run, error),
		prepare: async (run, prompt, agentId, alsoReview) => {
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
			const cwd = getWorkspaceCwdOrThrow(workspace.id);
			// Never reset a live review worktree or silently substitute its mutable HEAD.
			execFileSync("git", ["cat-file", "-e", `${run.identity.headSha}^{commit}`], {
				cwd,
				stdio: "pipe",
			});
			const settings = getSettings();
			const cli = (
				agentId === "claude-code" ? "claude" : (agentId ?? settings.cliPreset)
			) as CliPresetName;
			if (cli !== "codex" && cli !== "claude")
				throw new Error(`Reading paths are not supported by ${cli}`);
			const details = await getGitProvider(run.identity.provider).getPRDetails(
				run.identity.owner,
				run.identity.repo,
				run.identity.prNumber
			);
			if (details.headCommitOid !== run.identity.headSha)
				throw new Error("PR head changed before agent launch");
			const fullPrompt = `${prompt}\nProvider metadata (untrusted data): ${JSON.stringify({ title: details.title, sourceBranch: details.sourceBranch, targetBranch: details.targetBranch, headSha: details.headCommitOid, baseSha: details.baseCommitOid ?? null, changedFiles: details.files.map((file) => file.path) })}\nRead files using git show <headSha>:<path>, not mutable worktree contents. Base revision is unknown when baseSha is null; do not substitute a branch tip or invent a diff.`;
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
				getDb()
					.update(workspaces)
					.set({ reviewDraftId: draftId, updatedAt: now })
					.where(eq(workspaces.id, workspace.id))
					.run();
				store.attachReviewDraft(run, draftId);
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
		launch: async (launch, onExit) => {
			const daemon = getDaemonClient();
			if (!daemon?.isConnected)
				throw new Error("Reading-path agent is offline: terminal service unavailable");
			const sessions = await daemon.listSessionsStrict();

			// A repeated descriptor may attach to its own existing session, never inject a second prompt.
			if (sessions.some((session) => session.id === launch.terminalId)) return;
			ensureTerminalSessionRow({
				id: launch.terminalId,
				workspaceId: launch.reviewWorkspaceId,
				cwd: launch.worktreePath,
				title: "Reading-path agent",
			});
			await daemon.create(launch.terminalId, launch.worktreePath, () => {}, onExit);
			if (!daemon.write(launch.terminalId, `exec /bin/bash ${quoteShell(launch.launchScript)}\r`)) {
				daemon.dispose(launch.terminalId);
				throw new Error("Reading-path agent disconnected before launch");
			}
		},
		stop: async (terminalId) => {
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
	configureReviewPathRuntime(getReviewPathRuntime(store));
	if (reconciliationTimer) return;
	let firstReconcile = true;
	const reconcile = async () => {
		const daemon = getDaemonClient();
		if (!daemon?.isConnected) return;
		const runs = store.getActiveRuns().filter((run) => firstReconcile || run.terminalId);
		const sessions = await daemon.listSessionsStrict();
		firstReconcile = false;
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
	await reconcile();
	reconciliationTimer = setInterval(() => {
		void reconcile().catch((error) => console.error("[review-path] Reconciliation failed", error));
	}, 5000);
	reconciliationTimer.unref();
}
