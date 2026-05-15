// Mirrors apps/desktop/src/renderer/components/SolveReviewTab.tsx. Static (no tRPC, no stores) — hardcoded ready-state session.

import { SolveDiffPane } from "./SolveDiffPane";
import { SolveSidebar } from "./SolveSidebar";

export type SolveSessionStatus =
	| "queued"
	| "in_progress"
	| "ready"
	| "submitted"
	| "failed"
	| "dismissed"
	| "cancelled";

export type SolveGroupStatus = "pending" | "fixed" | "approved" | "submitted" | "reverted";

export type SolveCommentStatus = "open" | "fixed" | "unclear" | "wont_fix" | "changes_requested";

export type SolveReplyStatus = "draft" | "approved" | "posted";

export interface ChangedFile {
	path: string;
	changeType: "A" | "M" | "D" | "R";
	additions: number;
	deletions: number;
}

export interface SolveReplyInfo {
	id: string;
	body: string;
	status: SolveReplyStatus;
}

export interface SolveCommentInfo {
	id: string;
	platformCommentId: string;
	author: string;
	body: string;
	filePath: string;
	lineNumber: number | null;
	side: string | null;
	threadId: string | null;
	status: SolveCommentStatus;
	commitSha: string | null;
	groupId: string | null;
	followUpText: string | null;
	reply: SolveReplyInfo | null;
}

export interface SolveGroupInfo {
	id: string;
	label: string;
	status: SolveGroupStatus;
	commitHash: string | null;
	order: number;
	changedFiles: ChangedFile[];
	comments: SolveCommentInfo[];
}

export interface SolveSessionInfo {
	id: string;
	prProvider: string;
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	status: SolveSessionStatus;
	commitSha: string | null;
	workspaceId: string;
	createdAt: Date;
	updatedAt: Date;
	lastActivityAt: Date | null;
	groups: SolveGroupInfo[];
}

const COMMENT_BODY_1 = `Cancel the stream subscription when the terminal closes — we're leaking handlers on unmount.

\`\`\`
return () => sub.unsubscribe();
\`\`\`

The current useRef approach holds the subscription past unmount.`;

const COMMENT_BODY_2 =
	"Also make sure the cleanup runs before re-subscribing on sessionId change — otherwise we double-subscribe for one tick.";

const ACTIVE_FILE_PATH = "src/renderer/hooks/useAgentTerminalStream.ts";

export const MOCK_SESSION: SolveSessionInfo = {
	id: "session-1",
	prProvider: "github",
	prIdentifier: "superiorswarm/superiorswarm#214",
	prTitle: "feat: agent terminal chat",
	sourceBranch: "feat/agent-terminal-chat",
	targetBranch: "main",
	status: "ready",
	commitSha: "d8f3a2b",
	workspaceId: "ws-1",
	createdAt: new Date(),
	updatedAt: new Date(),
	lastActivityAt: new Date(),
	groups: [
		{
			id: "g1",
			label: "Unsubscribe stream on terminal close",
			status: "submitted",
			commitHash: "d8f3a2b",
			order: 0,
			changedFiles: [
				{
					path: "src/renderer/hooks/useAgentTerminalStream.ts",
					changeType: "M",
					additions: 12,
					deletions: 2,
				},
				{
					path: "src/renderer/components/terminal/Terminal.tsx",
					changeType: "M",
					additions: 4,
					deletions: 0,
				},
			],
			comments: [
				{
					id: "c1",
					platformCommentId: "pc1",
					author: "sam",
					body: COMMENT_BODY_1,
					filePath: ACTIVE_FILE_PATH,
					lineNumber: 42,
					side: "RIGHT",
					threadId: null,
					status: "fixed",
					commitSha: "d8f3a2b",
					groupId: "g1",
					followUpText: null,
					reply: null,
				},
				{
					id: "c2",
					platformCommentId: "pc2",
					author: "sam",
					body: COMMENT_BODY_2,
					filePath: ACTIVE_FILE_PATH,
					lineNumber: 56,
					side: "RIGHT",
					threadId: null,
					status: "fixed",
					commitSha: "d8f3a2b",
					groupId: "g1",
					followUpText: null,
					reply: null,
				},
			],
		},
		{
			id: "g2",
			label: "Pass theme through to xterm",
			status: "submitted",
			commitHash: "b41c082",
			order: 1,
			changedFiles: [
				{
					path: "src/renderer/components/terminal/Terminal.tsx",
					changeType: "M",
					additions: 18,
					deletions: 4,
				},
			],
			comments: [
				{
					id: "c3",
					platformCommentId: "pc3",
					author: "jordan",
					body: "Pass `theme` through so light mode picks up the right ANSI palette.",
					filePath: "src/renderer/components/terminal/Terminal.tsx",
					lineNumber: 88,
					side: "RIGHT",
					threadId: null,
					status: "fixed",
					commitSha: "b41c082",
					groupId: "g2",
					followUpText: null,
					reply: null,
				},
			],
		},
		{
			id: "g3",
			label: "Stable MCP server identifiers",
			status: "submitted",
			commitHash: "7e2a195",
			order: 2,
			changedFiles: [
				{
					path: "src/renderer/main/mcp/mcp-server-registry.ts",
					changeType: "M",
					additions: 8,
					deletions: 2,
				},
			],
			comments: [
				{
					id: "c4",
					platformCommentId: "pc4",
					author: "sam",
					body: "Keep MCP server identifiers stable across refreshes — clients are caching them.",
					filePath: "src/renderer/main/mcp/mcp-server-registry.ts",
					lineNumber: 16,
					side: "RIGHT",
					threadId: null,
					status: "fixed",
					commitSha: "7e2a195",
					groupId: "g3",
					followUpText: null,
					reply: null,
				},
			],
		},
		{
			id: "g4",
			label: "Add tests for terminal cleanup",
			status: "submitted",
			commitHash: "f1d3c4e",
			order: 3,
			changedFiles: [
				{
					path: "src/renderer/hooks/useAgentTerminalStream.test.ts",
					changeType: "A",
					additions: 34,
					deletions: 0,
				},
			],
			comments: [],
		},
	],
};

const EXPANDED_GROUP_IDS = new Set<string>(["g1"]);

export function SolveReviewTab() {
	const session = MOCK_SESSION;

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="px-7 pt-[22px] pb-[18px] border-b border-[var(--border-subtle)]">
				<PRHeader session={session} />
				<ProgressStrip />
			</div>
			<div className="flex flex-1 min-h-0 overflow-hidden">
				<div className="w-[300px] shrink-0">
					<SolveSidebar
						session={session}
						expandedGroupIds={EXPANDED_GROUP_IDS}
						activeFilePath={ACTIVE_FILE_PATH}
					/>
				</div>
				<div className="flex-1 min-w-0">
					<SolveDiffPane session={session} activeFilePath={ACTIVE_FILE_PATH} />
				</div>
			</div>
			<BottomBar />
		</div>
	);
}

function PRHeader({ session }: { session: SolveSessionInfo }) {
	return (
		<div className="mb-5">
			<div className="flex justify-between items-center mb-[6px]">
				<div className="flex items-center gap-2">
					<span className="[font-family:var(--font-mono)] text-[11.5px] text-[var(--text-tertiary)]">
						{session.prIdentifier}
					</span>
					<span className="[font-family:var(--font-mono)] inline-flex items-center gap-[5px] px-2 py-[2px] bg-[var(--bg-elevated)] rounded-[4px] text-[10.5px] text-[var(--text-secondary)]">
						{session.sourceBranch}
						<span className="text-[var(--text-tertiary)] text-[9px]">→</span>
						{session.targetBranch}
					</span>
				</div>
			</div>
			<div className="text-[17px] font-semibold tracking-[-0.03em] leading-[1.35]">
				{session.prTitle}
			</div>
		</div>
	);
}

function StatusPill({
	color,
	bg,
	count,
	label,
}: {
	color: string;
	bg: string;
	count: number;
	label: string;
}) {
	return (
		<span
			style={{ background: bg, color }}
			className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium"
		>
			<span className="w-1 h-1 rounded-full bg-current" />
			{count} {label}
		</span>
	);
}

function ProgressStrip() {
	return (
		<div className="mb-[22px]">
			<div className="flex gap-[5px] mb-[10px]">
				<StatusPill color="var(--success)" bg="var(--success-subtle)" count={4} label="resolved" />
			</div>
			<div className="flex justify-between items-center mb-[5px]">
				<span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
					Approval
				</span>
				<div className="flex items-center gap-[8px]">
					<span className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
						4 pushed · 0 approved / 4
					</span>
				</div>
			</div>
			<div className="h-[2px] bg-[var(--bg-elevated)] rounded-[1px] overflow-hidden">
				<div
					className="h-full bg-[var(--success)] rounded-[1px]"
					style={{ width: "100%", transition: "width 0.5s ease" }}
				/>
			</div>
		</div>
	);
}

function BottomBar() {
	return (
		<div className="border-t border-[var(--border-subtle)]">
			<div className="px-7 py-3 flex items-center justify-end gap-[6px]">
				<button
					type="button"
					className="px-[14px] py-[6px] rounded-[6px] text-[12px] font-medium text-[var(--text-secondary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Revert remaining
				</button>
			</div>
		</div>
	);
}
