import type { DiffHunk, DiffLine } from "../../shared/diff-types";
import type { AIDraftThread, GitHubReviewThread, UnifiedThread } from "../../shared/github-types";

export type ThreadFilter = "all" | "pending" | "accepted" | "declined" | "open" | "resolved";
export type ThreadBucket = Exclude<ThreadFilter, "all">;
export type CondensedFilter = "all" | "attention" | "done";
export type ReviewCommentFilter = ThreadFilter | Exclude<CondensedFilter, "all">;

const CHANGES_DRAFT_STATUSES = new Set<AIDraftThread["status"]>([
	"pending",
	"edited",
	"user-pending",
]);

export const CONDENSED_TO_FILTERS: Record<CondensedFilter, ThreadFilter[]> = {
	all: ["all"],
	attention: ["pending", "open"],
	done: ["declined", "resolved"],
};

export interface DraftCommentLike {
	id: string;
	filePath: string;
	lineNumber: number | null;
	side?: string | null;
	body: string;
	status: string;
	userEdit?: string | null;
	createdAt: string | Date;
	resolution?: string | null;
}

export interface DraftLike {
	id: string;
	prIdentifier: string;
	status: string;
	roundNumber?: number | null;
}

export const DRAFT_STATUS_PRIORITY: Record<string, number> = {
	ready: 0,
	in_progress: 1,
	queued: 2,
	submitted: 3,
	failed: 4,
};

/** True while any review draft is queued or running — the only time polling is useful. */
export function hasActiveReviewDraft(
	drafts: ReadonlyArray<{ status: string }> | undefined
): boolean {
	return (drafts ?? []).some((d) => d.status === "queued" || d.status === "in_progress");
}

export function threadBucket(t: UnifiedThread): ThreadBucket {
	if (t.isAIDraft) {
		switch (t.status) {
			case "pending":
			case "edited":
			case "error":
				return "pending";
			case "user-pending":
			case "approved":
				return "accepted";
			case "rejected":
				return "declined";
			case "submitted":
				return "resolved";
		}
	}

	return (t as GitHubReviewThread).isResolved ? "resolved" : "open";
}

export function normalizeDraftStatus(status: string): AIDraftThread["status"] {
	switch (status) {
		case "pending":
		case "approved":
		case "rejected":
		case "edited":
		case "submitted":
		case "user-pending":
		case "error":
			return status;
		default:
			return "pending";
	}
}

export function matchesFilter(t: UnifiedThread, f: ThreadFilter): boolean {
	return f === "all" || threadBucket(t) === f;
}

export function filtersForReviewFilter(filter: ReviewCommentFilter): ThreadFilter[] {
	if (filter === "attention" || filter === "done") return CONDENSED_TO_FILTERS[filter];
	return [filter];
}

export function matchesReviewFilter(t: UnifiedThread, filter: ReviewCommentFilter): boolean {
	const filters = filtersForReviewFilter(filter);
	return filters.includes("all") || filters.includes(threadBucket(t));
}

export function threadCounts(threads: UnifiedThread[]): Record<ThreadFilter, number> {
	const counts: Record<ThreadFilter, number> = {
		all: threads.length,
		pending: 0,
		accepted: 0,
		declined: 0,
		open: 0,
		resolved: 0,
	};

	for (const thread of threads) {
		counts[threadBucket(thread)] += 1;
	}

	return counts;
}

export function draftStatusAfterEdit(status: AIDraftThread["status"]): "edited" | "user-pending" {
	return status === "user-pending" || status === "approved" ? "user-pending" : "edited";
}

export function canAcceptDraft(
	thread: UnifiedThread | null
): thread is AIDraftThread & { status: "pending" | "edited" } {
	return thread?.isAIDraft === true && (thread.status === "pending" || thread.status === "edited");
}

export function canEditDraft(thread: UnifiedThread | null): thread is AIDraftThread {
	return (
		thread?.isAIDraft === true &&
		(thread.status === "pending" ||
			thread.status === "edited" ||
			thread.status === "user-pending" ||
			thread.status === "approved")
	);
}

export function canDeclineDraft(thread: UnifiedThread | null): thread is AIDraftThread {
	return canEditDraft(thread);
}

export function canReplyToThread(thread: UnifiedThread | null): thread is GitHubReviewThread {
	return thread !== null && thread.isAIDraft !== true && !thread.isResolved;
}

export function fileCommentCounts(threads: UnifiedThread[]): Map<string, number> {
	const counts = new Map<string, number>();

	for (const thread of threads) {
		if (thread.isAIDraft) {
			if (!isDraftCountedForFileBadge(thread.status)) continue;
		} else if (thread.isResolved) {
			continue;
		}
		counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
	}

	return counts;
}

/**
 * Threads that belong in the Changes view for one file. Published provider
 * comments can be hidden independently, while actionable AI/user drafts stay
 * visible so review work is never concealed by the display preference.
 */
export function changesThreadsForFile(
	threads: UnifiedThread[],
	filePath: string | null,
	publishedCommentsVisible: boolean
): UnifiedThread[] {
	if (filePath === null) return [];

	return threads
		.filter((thread) => {
			if (thread.path !== filePath) return false;
			if (!thread.isAIDraft) return publishedCommentsVisible;
			return CHANGES_DRAFT_STATUSES.has(thread.status);
		})
		.sort((a, b) => {
			const lineA = a.line ?? Number.MAX_SAFE_INTEGER;
			const lineB = b.line ?? Number.MAX_SAFE_INTEGER;
			if (lineA !== lineB) return lineA - lineB;
			return a.id.localeCompare(b.id);
		});
}

export interface ChangesThreadLayout {
	leftInline: UnifiedThread[];
	rightInline: UnifiedThread[];
	fallback: UnifiedThread[];
}

/** Partition visible Changes threads by their renderable Monaco pane. */
export function partitionChangesThreads(
	threads: UnifiedThread[],
	diffMode: "split" | "inline",
	editorVisible: boolean,
	lineCounts: Record<UnifiedThread["diffSide"], number> = {
		LEFT: Number.MAX_SAFE_INTEGER,
		RIGHT: Number.MAX_SAFE_INTEGER,
	}
): ChangesThreadLayout {
	const layout: ChangesThreadLayout = {
		leftInline: [],
		rightInline: [],
		fallback: [],
	};

	for (const thread of threads) {
		const lineIsRenderable =
			thread.line != null && thread.line >= 1 && thread.line <= lineCounts[thread.diffSide];
		if (!editorVisible || !lineIsRenderable) {
			layout.fallback.push(thread);
		} else if (thread.diffSide === "LEFT") {
			(diffMode === "split" ? layout.leftInline : layout.fallback).push(thread);
		} else {
			layout.rightInline.push(thread);
		}
	}

	return layout;
}

export function mapDraftComment(c: DraftCommentLike, roundNumber?: number): AIDraftThread {
	const thread: AIDraftThread = {
		id: `ai-${c.id}`,
		isAIDraft: true,
		draftCommentId: c.id,
		path: c.filePath,
		line: c.lineNumber,
		diffSide: c.side === "LEFT" ? "LEFT" : "RIGHT",
		body: c.body,
		status: normalizeDraftStatus(c.status),
		userEdit: c.userEdit ?? null,
		createdAt: typeof c.createdAt === "string" ? c.createdAt : c.createdAt.toISOString(),
		resolution: c.resolution ?? null,
	};

	if (roundNumber !== undefined) {
		thread.roundNumber = roundNumber;
	}

	return thread;
}

export function pickLatestDraft<T extends DraftLike>(
	drafts: T[] | undefined,
	prIdentifier: string
): T | undefined {
	let latest: T | undefined;

	for (const draft of drafts ?? []) {
		if (draft.prIdentifier !== prIdentifier) continue;
		if (!latest) {
			latest = draft;
			continue;
		}

		const priority = DRAFT_STATUS_PRIORITY[draft.status] ?? 5;
		const latestPriority = DRAFT_STATUS_PRIORITY[latest.status] ?? 5;
		if (priority < latestPriority) {
			latest = draft;
			continue;
		}

		if (priority === latestPriority && (draft.roundNumber ?? 1) > (latest.roundNumber ?? 1)) {
			latest = draft;
		}
	}

	return latest;
}

export function pickActiveDraft<T extends DraftLike>(
	drafts: T[] | undefined,
	prIdentifier: string
): T | undefined {
	let active: T | undefined;

	for (const draft of drafts ?? []) {
		if (draft.prIdentifier !== prIdentifier) continue;
		if (draft.status !== "queued" && draft.status !== "in_progress") continue;
		if (!active) {
			active = draft;
			continue;
		}

		const priority = draft.status === "in_progress" ? 0 : 1;
		const activePriority = active.status === "in_progress" ? 0 : 1;
		if (priority < activePriority) {
			active = draft;
			continue;
		}
		if (priority === activePriority && (draft.roundNumber ?? 1) > (active.roundNumber ?? 1)) {
			active = draft;
		}
	}

	return active;
}

export function groupThreadsByFile(
	threads: UnifiedThread[],
	fileOrder: string[]
): Array<{ path: string; threads: UnifiedThread[] }> {
	const order = new Map(fileOrder.map((path, index) => [path, index]));
	const grouped = new Map<string, UnifiedThread[]>();

	for (const thread of threads) {
		const list = grouped.get(thread.path);
		if (list) {
			list.push(thread);
		} else {
			grouped.set(thread.path, [thread]);
		}
	}

	return Array.from(grouped.entries())
		.sort(([a], [b]) => {
			const aOrder = order.get(a);
			const bOrder = order.get(b);
			if (aOrder != null && bOrder != null) return aOrder - bOrder;
			if (aOrder != null) return -1;
			if (bOrder != null) return 1;
			return a.localeCompare(b);
		})
		.map(([path, fileThreads]) => ({
			path,
			threads: [...fileThreads].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
		}));
}

export function threadAuthor(t: UnifiedThread): string {
	if (t.isAIDraft) return "SuperiorSwarm AI";
	return (t as GitHubReviewThread).comments[0]?.author ?? "Unknown";
}

export function threadDate(t: UnifiedThread): string {
	if (t.isAIDraft) return t.createdAt;
	return (t as GitHubReviewThread).comments[0]?.createdAt ?? "";
}

export function threadExcerpt(t: UnifiedThread): string {
	if (t.isAIDraft) return firstLine(t.userEdit ?? t.body);
	return firstLine((t as GitHubReviewThread).comments[0]?.body);
}

export function extractDiffContext(hunks: DiffHunk[], line: number, context = 2): DiffLine[] {
	const radius = Math.max(0, Math.floor(context));

	for (const hunk of hunks) {
		const index = hunk.lines.findIndex((diffLine) => diffLine.newLineNumber === line);
		if (index === -1) continue;

		const start = Math.max(0, index - radius);
		const end = Math.min(hunk.lines.length, index + radius + 1);
		return hunk.lines.slice(start, end);
	}

	return [];
}

function firstLine(value: string | null | undefined): string {
	return (value ?? "").split(/\r?\n/, 1)[0] ?? "";
}

function isDraftCountedForFileBadge(status: AIDraftThread["status"]): boolean {
	switch (status) {
		case "pending":
		case "approved":
		case "edited":
		case "user-pending":
		case "error":
			return true;
		case "rejected":
		case "submitted":
			return false;
	}
}
