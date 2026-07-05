import type { DiffHunk, DiffLine } from "../../shared/diff-types";
import type { AIDraftThread, GitHubReviewThread, UnifiedThread } from "../../shared/github-types";

export type ThreadFilter = "all" | "pending" | "accepted" | "declined" | "open" | "resolved";
export type ThreadBucket = Exclude<ThreadFilter, "all">;
export type CondensedFilter = "all" | "attention" | "done";

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
