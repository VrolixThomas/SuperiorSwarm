import { spawn } from "node:child_process";
import { mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { parsePrIdentifier } from "../../shared/pr-identifier";
import type { ReviewFetchProgress } from "../../shared/review-fetch-progress";
import type { ReviewSnapshotRevision } from "../../shared/review-snapshot-types";
import { getDb } from "../db";
import { projects, workspaces, worktrees } from "../db/schema";
import {
	getReviewRevisionAuthorization,
	resolveReviewRevisionSources,
} from "../review-explanation/acquisition-service";
import { readGit } from "../review-explanation/git-reader";
import {
	ReviewRevisionAcquisition,
	type RevisionSources,
	type fetchRevisionObjects,
} from "../review-explanation/revision-acquisition";
import { assertWorktreePathAvailable } from "../services/worktree-cleanup-job-store";
import { resumeWorktreeServices } from "../services/worktree-deletion-coordinator";

export interface ReviewWorkspaceInput {
	projectId: string;
	prProvider: "github" | "bitbucket";
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
}

interface PreparationOptions {
	timeoutMs?: number;
	metadataTimeoutMs?: number;
	resolveSources?: typeof resolveReviewRevisionSources;
	getAuthorization?: typeof getReviewRevisionAuthorization;
	fetchObjects?: typeof fetchRevisionObjects;
}

/** Local checkout only. Abort kills the process group before this operation settles. */
export function runReviewWorktreeGit(
	root: string,
	args: string[],
	signal: AbortSignal
): Promise<void> {
	if (signal.aborted) return Promise.reject(new Error("Review workspace preparation cancelled"));
	return new Promise((resolvePromise, reject) => {
		let stopped = false;
		const child = spawn(
			"git",
			["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
			{
				cwd: root,
				stdio: "ignore",
				detached: process.platform !== "win32",
				env: {
					PATH: process.env["PATH"],
					SystemRoot: process.env["SystemRoot"],
					LANG: "C",
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_SYSTEM: "/dev/null",
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_NO_REPLACE_OBJECTS: "1",
					GIT_NO_LAZY_FETCH: "1",
					GIT_ALLOW_PROTOCOL: "",
					GIT_TERMINAL_PROMPT: "0",
				},
			}
		);
		const stop = () => {
			stopped = true;
			try {
				if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				/* already exited */
			}
		};
		const timer = setTimeout(stop, 30_000);
		signal.addEventListener("abort", stop, { once: true });
		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", stop);
		};
		child.once("error", () => {
			cleanup();
			reject(new Error("Review worktree creation could not start"));
		});
		child.once("close", (code) => {
			cleanup();
			if (stopped || signal.aborted || code !== 0)
				reject(new Error("Review worktree preparation failed or timed out. Retry opening the PR."));
			else resolvePromise();
		});
		if (signal.aborted) stop();
	});
}

type PreparedWorkspace = typeof workspaces.$inferSelect & { worktreePath: string };

/** Opening a PR is metadata-only. Local object reads can use the registered project's root. */
export function getOrCreateReviewRecord(input: ReviewWorkspaceInput) {
	return getDb().transaction((db) => {
		const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
		if (!project) throw new Error("Project not found");
		if (project.kind === "folder")
			throw new Error("This project is a plain folder. This action requires a git repository.");
		const parts = parsePrIdentifier(input.prIdentifier);
		if (
			!parts ||
			!Number.isSafeInteger(parts.number) ||
			parts.number < 1 ||
			parts.owner.includes("/") ||
			parts.repo.includes("/")
		)
			throw new Error("Review PR identifier is invalid");
		const scope = and(
			eq(workspaces.projectId, input.projectId),
			eq(workspaces.prProvider, input.prProvider),
			eq(workspaces.prIdentifier, input.prIdentifier)
		);
		let workspace = db.select().from(workspaces).where(scope).get();
		if (workspace && workspace.type !== "review")
			throw new Error("Review workspace identity conflicts with another workspace");
		if (!workspace) {
			const id = nanoid();
			const now = new Date();
			db.insert(workspaces)
				.values({
					id,
					projectId: input.projectId,
					name: `PR #${parts.number}: ${input.prTitle}`,
					type: "review",
					prProvider: input.prProvider,
					prIdentifier: input.prIdentifier,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			workspace = db.select().from(workspaces).where(eq(workspaces.id, id)).get();
		}
		if (!workspace) throw new Error("Review workspace could not be registered");
		const worktree = workspace.worktreeId
			? db.select().from(worktrees).where(eq(worktrees.id, workspace.worktreeId)).get()
			: undefined;
		if (worktree && worktree.projectId !== input.projectId)
			throw new Error("Review worktree belongs to another project");
		return { ...workspace, worktreePath: worktree?.path ?? null };
	});
}

type PreparationPhase = "metadata" | "fetching" | "worktree";
interface PendingPreparation {
	listeners: Set<(phase: PreparationPhase) => void>;
	progressListeners: Set<(progress: ReviewFetchProgress) => void>;
	progress: () => ReviewFetchProgress | undefined;
	phase: () => PreparationPhase;
	controller: AbortController;
	promise: Promise<PreparedWorkspace>;
	consumers: number;
	settled: boolean;
	expectedHeadOid?: string;
}

/** Agent preparation only; never fetches or resets an already registered worktree. */
export class ReviewWorkspacePreparer {
	private readonly pending = new Map<string, PendingPreparation>();
	constructor(private readonly options: PreparationOptions = {}) {}

	open(
		input: ReviewWorkspaceInput,
		opts: {
			signal?: AbortSignal;
			expectedHeadOid?: string;
			onPhase?: (phase: PreparationPhase) => void;
			onFetchProgress?: (progress: ReviewFetchProgress) => void;
		} = {}
	): Promise<PreparedWorkspace> {
		if (opts.signal?.aborted)
			return Promise.reject(new Error("Review workspace preparation cancelled"));
		const key = JSON.stringify([input.projectId, input.prProvider, input.prIdentifier]);
		let entry = this.pending.get(key);
		if (entry && entry.expectedHeadOid !== opts.expectedHeadOid)
			return Promise.reject(
				new Error("Review preparation is already running for another revision")
			);
		if (!entry) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 13 * 60_000);
			const cancelled = new Promise<never>((_resolve, reject) =>
				controller.signal.addEventListener(
					"abort",
					() =>
						reject(
							new Error("Review workspace preparation cancelled or timed out. Retry the action.")
						),
					{ once: true }
				)
			);
			const listeners = new Set<(phase: PreparationPhase) => void>();
			let phase: PreparationPhase = "metadata";
			const progressListeners = new Set<(progress: ReviewFetchProgress) => void>();
			let progress: ReviewFetchProgress | undefined;
			const reportProgress = (next: ReviewFetchProgress) => {
				progress = next;
				for (const listener of progressListeners) listener(next);
			};
			const report = (next: PreparationPhase) => {
				phase = next;
				for (const listener of listeners) listener(next);
			};
			const promise = Promise.race([
				this.prepare(input, controller.signal, opts.expectedHeadOid, report, reportProgress),
				cancelled,
			]).finally(() => {
				clearTimeout(timeout);
				owned.settled = true;
				if (this.pending.get(key) === owned) this.pending.delete(key);
			});
			const owned: PendingPreparation = {
				listeners,
				progressListeners,
				progress: () => progress,
				phase: () => phase,
				controller,
				consumers: 0,
				settled: false,
				expectedHeadOid: opts.expectedHeadOid,
				promise,
			};
			entry = owned;
			this.pending.set(key, entry);
		}
		const owned = entry;
		if (opts.onPhase) {
			owned.listeners.add(opts.onPhase);
			opts.onPhase(owned.phase());
		}
		if (opts.onFetchProgress) {
			owned.progressListeners.add(opts.onFetchProgress);
			const progress = owned.progress();
			if (progress) opts.onFetchProgress(progress);
		}
		owned.consumers++;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			if (opts.onPhase) owned.listeners.delete(opts.onPhase);
			if (opts.onFetchProgress) owned.progressListeners.delete(opts.onFetchProgress);
			owned.consumers--;
			if (!owned.consumers && !owned.settled) owned.controller.abort();
		};
		let onAbort = () => {};
		const cancelled = new Promise<never>((_resolve, reject) => {
			onAbort = () => {
				release();
				reject(new Error("Review workspace preparation cancelled"));
			};
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			if (opts.signal?.aborted) onAbort();
		});
		return Promise.race([owned.promise, cancelled]).finally(() => {
			opts.signal?.removeEventListener("abort", onAbort);
			release();
		});
	}

	private async resolveMetadata(operation: () => Promise<RevisionSources>, signal: AbortSignal) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort = () => {};
		try {
			return await Promise.race([
				operation(),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() => reject(new Error("Review workspace metadata timed out. Retry preparation.")),
						this.options.metadataTimeoutMs ?? 60_000
					);
					onAbort = () => reject(new Error("Review workspace preparation cancelled"));
					signal.addEventListener("abort", onAbort, { once: true });
					if (signal.aborted) onAbort();
				}),
			]);
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
		}
	}

	private async prepare(
		input: ReviewWorkspaceInput,
		signal: AbortSignal,
		expectedHeadOid?: string,
		onPhase?: (phase: PreparationPhase) => void,
		onFetchProgress?: (progress: ReviewFetchProgress) => void
	): Promise<PreparedWorkspace> {
		const db = getDb();
		const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
		if (!project) throw new Error("Project not found");
		if (project.kind === "folder")
			throw new Error("This project is a plain folder. This action requires a git repository.");
		const parts = parsePrIdentifier(input.prIdentifier);
		if (
			!parts ||
			!Number.isSafeInteger(parts.number) ||
			parts.number < 1 ||
			parts.owner.includes("/") ||
			parts.repo.includes("/")
		)
			throw new Error("Review PR identifier is invalid");
		const scope = and(
			eq(workspaces.projectId, input.projectId),
			eq(workspaces.prProvider, input.prProvider),
			eq(workspaces.prIdentifier, input.prIdentifier)
		);
		const existing = getOrCreateReviewRecord(input);
		if (existing && existing.type !== "review")
			throw new Error("Review workspace identity conflicts with another workspace");
		const root = await realpath(project.repoPath);
		const review = { provider: input.prProvider, ...parts };
		const validate = () => {
			signal.throwIfAborted();
			const currentProject = db
				.select()
				.from(projects)
				.where(eq(projects.id, input.projectId))
				.get();
			const currentWorkspace = db.select().from(workspaces).where(scope).get();
			if (
				currentProject?.repoPath !== project.repoPath ||
				currentProject.kind === "folder" ||
				currentWorkspace?.id !== existing?.id ||
				currentWorkspace?.worktreeId !== existing?.worktreeId
			)
				throw new Error("Review workspace changed during preparation. Reopen the PR.");
		};
		const commonDir = async (path: string) =>
			realpath(
				resolve(
					path,
					(await readGit(path, ["rev-parse", "--git-common-dir"], signal)).toString().trim()
				)
			);
		const requireLegacyBase = async (path: string, sources: RevisionSources) => {
			const ref = `refs/remotes/origin/${input.targetBranch}`;
			try {
				await readGit(path, ["check-ref-format", ref], signal);
				const base = (await readGit(path, ["rev-parse", "--verify", `${ref}^{commit}`], signal))
					.toString()
					.trim();
				if (base !== sources.targetTipOid) throw new Error("base mismatch");
			} catch {
				signal.throwIfAborted();
				throw new Error(
					"Review cannot establish the current target base for this checkout-based review. Refresh the repository's target branch before retrying; refs and files were preserved."
				);
			}
		};
		if (existing?.worktreeId) {
			const worktree = db
				.select()
				.from(worktrees)
				.where(eq(worktrees.id, existing.worktreeId))
				.get();
			if (!worktree || worktree.projectId !== project.id)
				throw new Error("Review worktree is unavailable");
			assertWorktreePathAvailable(worktree.path);
			if ((await commonDir(root)) !== (await commonDir(worktree.path)))
				throw new Error("Review worktree belongs to another repository");
			if (!expectedHeadOid) {
				// Legacy agents read the checkout. Reject stale/dirty content without resetting it.
				const status = await readGit(
					worktree.path,
					["status", "--porcelain", "-z", "--untracked-files=normal"],
					signal
				);
				if (status.length)
					throw new Error(
						"Review workspace contains local changes. Preserve or move those changes before starting a checkout-based review."
					);
				const sources = await this.resolveMetadata(
					() => (this.options.resolveSources ?? resolveReviewRevisionSources)({ review }),
					signal
				);
				validate();
				const head = (
					await readGit(worktree.path, ["rev-parse", "--verify", "HEAD^{commit}"], signal)
				)
					.toString()
					.trim();
				if (sources.headOid !== head)
					throw new Error(
						"Review PR head differs from this worktree. Use a fresh review worktree for the current revision; existing files were preserved."
					);
				await requireLegacyBase(worktree.path, sources);
			}
			validate();
			return { ...existing, worktreePath: worktree.path };
		}
		const resolveSources = this.options.resolveSources ?? resolveReviewRevisionSources;
		const sources: RevisionSources = await this.resolveMetadata(
			() => resolveSources({ review }),
			signal
		);
		validate();
		if (expectedHeadOid && sources.headOid !== expectedHeadOid)
			throw new Error("Review PR head changed before workspace preparation");
		if (!expectedHeadOid) await requireLegacyBase(root, sources);
		const workspaceId = existing?.id ?? nanoid();
		const revision: ReviewSnapshotRevision = {
			workspaceId,
			review,
			headOid: sources.headOid,
			targetTipOid: sources.targetTipOid,
		};
		const acquisition = new ReviewRevisionAcquisition({
			resolveRoot: async () => {
				validate();
				return root;
			},
			resolveSources: async () => sources,
			getAuthorization: this.options.getAuthorization ?? getReviewRevisionAuthorization,
			fetchObjects: this.options.fetchObjects,
		});
		onPhase?.("fetching");
		await acquisition.acquire(revision, signal, onFetchProgress);
		validate();
		const worktreeId = nanoid();
		const safeId = input.prIdentifier.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 100);
		const path = join(
			dirname(root),
			`${basename(root)}-worktrees`,
			`pr-review-${input.prProvider}-${safeId}-${worktreeId.slice(0, 8)}`
		);
		assertWorktreePathAvailable(path);
		let registered = false;
		let ownedPath = false;
		try {
			validate();
			await mkdir(dirname(path), { recursive: true });
			validate();
			await mkdir(path);
			ownedPath = true;
			validate();
			onPhase?.("worktree");
			await runReviewWorktreeGit(
				root,
				["worktree", "add", "--detach", "--", path, sources.headOid],
				signal
			);
			validate();
			const checkedOut = (await readGit(path, ["rev-parse", "--verify", "HEAD^{commit}"], signal))
				.toString()
				.trim();
			if (checkedOut !== sources.headOid)
				throw new Error("Review worktree revision could not be verified");
			validate();
			const now = new Date();
			const workspace = db.transaction((tx) => {
				validate();
				if (!existing)
					tx.insert(workspaces)
						.values({
							id: workspaceId,
							projectId: project.id,
							name: `PR #${parts.number}: ${input.prTitle}`,
							type: "review",
							prProvider: input.prProvider,
							prIdentifier: input.prIdentifier,
							createdAt: now,
							updatedAt: now,
						})
						.run();
				tx.insert(worktrees)
					.values({
						id: worktreeId,
						projectId: project.id,
						path,
						branch: input.sourceBranch,
						baseBranch: input.targetBranch,
						createdAt: now,
						updatedAt: now,
					})
					.run();
				tx.update(workspaces)
					.set({ worktreeId, updatedAt: now })
					.where(eq(workspaces.id, workspaceId))
					.run();
				const result = tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
				if (!result) throw new Error("Review workspace registration failed");
				return result;
			});
			registered = true;
			resumeWorktreeServices(path);
			return { ...workspace, worktreePath: path };
		} finally {
			if (!registered && ownedPath) {
				// This random path was created only by this request and was never exposed to the user.
				await runReviewWorktreeGit(
					root,
					["worktree", "remove", "--force", "--", path],
					AbortSignal.timeout(5000)
				).catch(() => {});
				await rm(path, { recursive: true, force: true });
			}
		}
	}
}

export const reviewWorkspacePreparer = new ReviewWorkspacePreparer();
