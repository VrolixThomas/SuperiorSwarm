export type ReviewPathStatus = "none" | "mapping" | "ready" | "failed" | "stale";

export interface ReviewPath {
	id: string;
	prKey: string; // formatPrIdentifier(prCtx)
	headSha: string; // PR head the path was built for; differs from details.headCommitOid => "stale"
	agent: { id: string; label: string }; // e.g. { id: "claude-code", label: "Claude Code" }
	status: ReviewPathStatus;
	progress?: { placed: number; total: number; currentFile?: string }; // while mapping
	reviewed?: { findings: number }; // set when the agent also reviewed
	entries: ReviewPathEntry[];
	otherFiles: string[]; // changed files the agent did not place
	threadNotes?: Record<string, AgentThreadNote>; // keyed by thread id
	error?: string; // when status === "failed"
	updatedAt: string; // ISO
}

export interface ReviewPathEntry {
	id: string;
	title: string; // short, e.g. "Submit a review"
	steps: ReviewPathStep[];
}

export type ReviewPathStep = ChangedFileStep | ContextFileStep;

interface ReviewPathStepBase {
	id: string;
	path: string; // repo-relative
	note: string; // one sentence
	detail?: string; // optional paragraph behind "more" (markdown, no images)
	focus: FocusRange[];
	alsoIn?: string[]; // other entry ids this file serves
}

export interface ChangedFileStep extends ReviewPathStepBase {
	kind: "changed";
	tests: StepTest[];
}

export interface ContextFileStep extends ReviewPathStepBase {
	kind: "context";
	addedBy: "agent" | "user";
	usedBy?: CodeReference[];
}

export interface StepTest {
	path: string;
	changed: boolean; // unchanged tests open as read-only context
}

export interface FocusRange {
	side: "LEFT" | "RIGHT";
	startLine: number;
	endLine: number;
}

export interface CodeReference {
	path: string;
	line: number;
	description: string;
}

export interface AgentThreadNote {
	verdict: "addressed" | "open" | "unclear";
	text: string;
	refs?: CodeReference[];
}

export interface AskMessage {
	id: string;
	role: "user" | "agent";
	text: string; // markdown
	anchor?: { path: string; side: "LEFT" | "RIGHT"; startLine: number; endLine: number };
	refs?: CodeReference[];
	createdAt: string;
}

export interface ReviewPathSettings {
	autoMapOnReviewRequest: boolean;
	alsoReview: boolean;
	defaultRailMode: "path" | "files" | "auto"; // auto = path when one exists
}
