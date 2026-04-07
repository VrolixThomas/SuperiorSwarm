import { and, eq } from "drizzle-orm";
import type { CachedPR } from "../../shared/review-types";
import { getDb } from "../db";
import type { ReviewDraft } from "../db/schema";
import * as schema from "../db/schema";
import type { ReviewLaunchInfo } from "./orchestrator";
import { getReviewDrafts, getSettings, queueReview } from "./orchestrator";
import { ensureReviewWorkspace } from "./review-workspace";

export function shouldAutoTriggerReview(args: {
	pr: CachedPR;
	autoReviewEnabled: boolean;
	existingDrafts: Map<string, string>;
	alreadyTriggeredAt: Date | null;
}): boolean {
	const { pr, autoReviewEnabled, existingDrafts, alreadyTriggeredAt } = args;

	if (!autoReviewEnabled) return false;
	if (pr.state !== "open") return false;
	if (pr.role !== "reviewer") return false;
	if (!pr.projectId) return false;
	// Persistent ledger: if we ever queued a first auto-review for this PR
	// (even in a previous app session), do not fire again.
	if (alreadyTriggeredAt !== null) return false;
	// Same-session safety net: if a draft is currently queued or in progress,
	// don't fire concurrently. (review_drafts.status check.)
	const draftStatus = existingDrafts.get(pr.identifier);
	if (draftStatus === "queued" || draftStatus === "in_progress") return false;

	return true;
}

export type AutoReviewLedger = {
	get: (
		provider: string,
		identifier: string
	) => { firstTriggeredAt: Date | null; lastTriggeredSha: string | null };
	markFirstTriggered: (provider: string, identifier: string) => void;
	markReReviewedAtSha: (provider: string, identifier: string, sha: string) => void;
};

type AutoTriggerDeps = {
	getSettings: () => {
		autoReviewEnabled: number | boolean;
		autoReReviewOnCommit?: number | boolean;
	};
	getReviewDrafts: () => ReviewDraft[];
	getProjectIdByRepo: (repoOwner: string, repoName: string) => string;
	ensureReviewWorkspace: (opts: {
		projectId: string;
		prProvider: string;
		prIdentifier: string;
		prTitle: string;
		sourceBranch: string;
		targetBranch: string;
	}) => Promise<{ workspaceId: string; worktreePath: string }>;
	queueReview: (opts: {
		prProvider: string;
		prIdentifier: string;
		prTitle: string;
		prAuthor: string;
		sourceBranch: string;
		targetBranch: string;
		workspaceId: string;
		worktreePath: string;
	}) => Promise<ReviewLaunchInfo>;
	ledger: AutoReviewLedger;
};

const defaultDeps: AutoTriggerDeps = {
	getSettings,
	getReviewDrafts,
	getProjectIdByRepo: (repoOwner, repoName) => {
		const db = getDb();
		const match = db
			.select({ id: schema.projects.id })
			.from(schema.projects)
			.where(
				and(eq(schema.projects.remoteOwner, repoOwner), eq(schema.projects.remoteRepo, repoName))
			)
			.get();

		if (match?.id) return match.id;

		const allProjects = db.select().from(schema.projects).orderBy(schema.projects.id).all();
		const repoNameLower = repoName.toLowerCase();
		const ownerLower = repoOwner.toLowerCase();
		const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const needlePattern = new RegExp(
			`(^|/)${escapeRegExp(ownerLower)}/${escapeRegExp(repoNameLower)}(/|$)`
		);
		const fallbackMatches = allProjects.filter((project) =>
			needlePattern.test(project.repoPath.toLowerCase())
		);

		if (fallbackMatches.length !== 1) return "";

		return fallbackMatches[0]?.id ?? "";
	},
	ensureReviewWorkspace,
	queueReview,
	ledger: {
		get: (provider, identifier) => {
			const db = getDb();
			const row = db
				.select({
					firstTriggeredAt: schema.trackedPrs.autoReviewFirstTriggeredAt,
					lastTriggeredSha: schema.trackedPrs.autoReviewLastTriggeredSha,
				})
				.from(schema.trackedPrs)
				.where(
					and(
						eq(schema.trackedPrs.provider, provider),
						eq(schema.trackedPrs.identifier, identifier)
					)
				)
				.get();
			return {
				firstTriggeredAt: row?.firstTriggeredAt ?? null,
				lastTriggeredSha: row?.lastTriggeredSha ?? null,
			};
		},
		markFirstTriggered: (provider, identifier) => {
			const db = getDb();
			const now = new Date();
			const { changes } = db
				.update(schema.trackedPrs)
				.set({ autoReviewFirstTriggeredAt: now, updatedAt: now })
				.where(
					and(
						eq(schema.trackedPrs.provider, provider),
						eq(schema.trackedPrs.identifier, identifier)
					)
				)
				.run();
			if (changes === 0) {
				console.warn(
					`[auto-trigger] markFirstTriggered affected 0 rows for ${provider}:${identifier} — row not in tracked_prs`
				);
			}
		},
		markReReviewedAtSha: (provider, identifier, sha) => {
			const db = getDb();
			const now = new Date();
			const { changes } = db
				.update(schema.trackedPrs)
				.set({ autoReviewLastTriggeredSha: sha, updatedAt: now })
				.where(
					and(
						eq(schema.trackedPrs.provider, provider),
						eq(schema.trackedPrs.identifier, identifier)
					)
				)
				.run();
			if (changes === 0) {
				console.warn(
					`[auto-trigger] markReReviewedAtSha affected 0 rows for ${provider}:${identifier} — row not in tracked_prs`
				);
			}
		},
	},
};

function isMoreActive(a: string, b: string): boolean {
	const priority: Record<string, number> = {
		in_progress: 0,
		queued: 1,
		ready: 2,
		failed: 3,
		submitted: 4,
		dismissed: 5,
	};
	return (priority[a] ?? 6) < (priority[b] ?? 6);
}

export async function maybeAutoTriggerReview(args: {
	pr: CachedPR;
	deps?: Partial<AutoTriggerDeps>;
}): Promise<ReviewLaunchInfo | null> {
	const deps = { ...defaultDeps, ...args.deps };
	const settings = deps.getSettings();
	const draftsByIdentifier = new Map<string, string>();
	for (const draft of deps.getReviewDrafts()) {
		const existing = draftsByIdentifier.get(draft.prIdentifier);
		if (!existing || isMoreActive(draft.status, existing)) {
			draftsByIdentifier.set(draft.prIdentifier, draft.status);
		}
	}
	const autoReviewEnabled = Boolean(settings.autoReviewEnabled);
	const projectId = deps.getProjectIdByRepo(args.pr.repoOwner, args.pr.repoName);
	const pr = { ...args.pr, projectId };

	const ledgerEntry = deps.ledger.get(pr.provider, pr.identifier);
	if (
		!shouldAutoTriggerReview({
			pr,
			autoReviewEnabled,
			existingDrafts: draftsByIdentifier,
			alreadyTriggeredAt: ledgerEntry.firstTriggeredAt,
		})
	) {
		return null;
	}

	const { workspaceId, worktreePath } = await deps.ensureReviewWorkspace({
		projectId: pr.projectId,
		prProvider: pr.provider,
		prIdentifier: pr.identifier,
		prTitle: pr.title,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
	});

	const launchInfo = await deps.queueReview({
		prProvider: pr.provider,
		prIdentifier: pr.identifier,
		prTitle: pr.title,
		prAuthor: pr.author.login,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		workspaceId,
		worktreePath,
	});

	// Mark ledger AFTER successful queue, not before. If queueReview fails the
	// ledger stays NULL and the next poll cycle retries — preferable to a stuck
	// "already triggered but never actually started" state.
	deps.ledger.markFirstTriggered(pr.provider, pr.identifier);

	return launchInfo;
}

export async function maybeAutoReReview(args: {
	pr: CachedPR;
	deps?: Partial<AutoTriggerDeps>;
}): Promise<ReviewLaunchInfo | null> {
	const deps = { ...defaultDeps, ...args.deps };
	const settings = deps.getSettings();

	if (!settings.autoReReviewOnCommit) return null;
	if (args.pr.state !== "open") return null;
	if (args.pr.role !== "reviewer") return null;

	const projectId = deps.getProjectIdByRepo(args.pr.repoOwner, args.pr.repoName);
	if (!projectId) return null;

	// Check that there's no active review running
	const drafts = deps.getReviewDrafts();
	const activeDraft = drafts.find(
		(d) =>
			d.prIdentifier === args.pr.identifier && (d.status === "queued" || d.status === "in_progress")
	);
	if (activeDraft) return null;

	// Persistent ledger: if we already re-reviewed this PR at the current head
	// SHA in any session, don't re-fire. Invariant: this path is only ever
	// entered when `diffTrackedPrs` detected a sha change, which requires both
	// old and new shas to be non-empty — so `args.pr.headCommitSha` is always
	// truthy here. The `markReReviewedAtSha` guard below is belt-and-braces.
	const ledgerEntry = deps.ledger.get(args.pr.provider, args.pr.identifier);
	if (ledgerEntry.lastTriggeredSha && ledgerEntry.lastTriggeredSha === args.pr.headCommitSha) {
		return null;
	}

	const { workspaceId, worktreePath } = await deps.ensureReviewWorkspace({
		projectId,
		prProvider: args.pr.provider,
		prIdentifier: args.pr.identifier,
		prTitle: args.pr.title,
		sourceBranch: args.pr.sourceBranch,
		targetBranch: args.pr.targetBranch,
	});

	const launchInfo = await deps.queueReview({
		prProvider: args.pr.provider,
		prIdentifier: args.pr.identifier,
		prTitle: args.pr.title,
		prAuthor: args.pr.author.login,
		sourceBranch: args.pr.sourceBranch,
		targetBranch: args.pr.targetBranch,
		workspaceId,
		worktreePath,
	});

	// Mark ledger AFTER success.
	if (args.pr.headCommitSha) {
		deps.ledger.markReReviewedAtSha(args.pr.provider, args.pr.identifier, args.pr.headCommitSha);
	}

	return launchInfo;
}
