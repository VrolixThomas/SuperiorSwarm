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
	alreadyTriggered: Set<string>;
}): boolean {
	const { pr, autoReviewEnabled, existingDrafts, alreadyTriggered } = args;

	if (!autoReviewEnabled) return false;
	if (pr.state !== "open") return false;
	if (pr.role !== "reviewer") return false;
	if (!pr.projectId) return false;
	if (alreadyTriggered.has(pr.identifier)) return false;
	// Only block if there's an active draft (queued or in_progress)
	const draftStatus = existingDrafts.get(pr.identifier);
	if (draftStatus === "queued" || draftStatus === "in_progress") return false;

	return true;
}

type AutoTriggerDeps = {
	getSettings: () => { autoReviewEnabled: number | boolean };
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
	alreadyTriggered: Set<string>;
};

const alreadyTriggeredThisSession = new Set<string>();

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
	alreadyTriggered: alreadyTriggeredThisSession,
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

	if (
		!shouldAutoTriggerReview({
			pr,
			autoReviewEnabled,
			existingDrafts: draftsByIdentifier,
			alreadyTriggered: deps.alreadyTriggered,
		})
	) {
		return null;
	}

	deps.alreadyTriggered.add(pr.identifier);

	const { workspaceId, worktreePath } = await deps.ensureReviewWorkspace({
		projectId: pr.projectId,
		prProvider: pr.provider,
		prIdentifier: pr.identifier,
		prTitle: pr.title,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
	});

	return deps.queueReview({
		prProvider: pr.provider,
		prIdentifier: pr.identifier,
		prTitle: pr.title,
		prAuthor: pr.author.login,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		workspaceId,
		worktreePath,
	});
}
