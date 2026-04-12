export const DEFAULT_SOLVE_GUIDELINES =
	"Fix the review comments by making the requested code changes. Focus on understanding the reviewer's intent and making precise, minimal changes.";

export interface SolveFollowUpOptions {
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	sessionId: string;
	groupLabel: string;
	commitHash: string;
	commentAuthor: string;
	commentFilePath: string;
	commentLineNumber: number | null;
	commentBody: string;
	commentStatus: string;
	followUpText: string;
}

export function buildSolveFollowUpPrompt(opts: SolveFollowUpOptions): string {
	const location = opts.commentLineNumber
		? `${opts.commentFilePath}:${opts.commentLineNumber}`
		: opts.commentFilePath;

	return `You are following up on a previous comment solve session.

PR: ${opts.prTitle}
Session ID: ${opts.sessionId}
Source: ${opts.sourceBranch} → Target: ${opts.targetBranch}

The user wants changes to group "${opts.groupLabel}" (commit ${opts.commitHash}).

Original comment by @${opts.commentAuthor} on ${location}:
"${opts.commentBody}"

The AI solver marked this as: ${opts.commentStatus}

User's follow-up instructions:
"${opts.followUpText}"

Use the SuperiorSwarm MCP tools. The session ID is already set in your environment.
Read the current code, make the requested changes, and call finish_fix_group when done.`;
}

export interface SolvePromptOptions {
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	commentCount: number;
	customPrompt: string | null;
}

export function buildSolvePrompt(opts: SolvePromptOptions): string {
	const guidelines = opts.customPrompt || DEFAULT_SOLVE_GUIDELINES;

	return `PR Context:
- Title: ${opts.prTitle}
- Branch: ${opts.sourceBranch} → ${opts.targetBranch}
- Unresolved comments: ${opts.commentCount}

You are helping the PR author fix review comments. Reviewers have left feedback
that needs to be addressed through code changes.

Guidelines:
${guidelines}

Instructions:
1. Call get_pr_comments to fetch all unresolved comments
2. Analyze comments and group related ones using submit_grouping
   - Group by semantic similarity (comments about the same concern)
   - A file may have comments in different groups
   - You determine the optimal grouping
3. For each group (in order):
   a. Call start_fix_group(groupId) to get the full comment details
   b. Read the relevant files and understand the codebase context
   c. Make code changes that address the comments
   d. For each comment in the group:
      - If you can fix it: call mark_comment_fixed(commentId)
      - If unclear: make a best-effort fix AND call mark_comment_unclear(commentId, replyBody)
        explaining your interpretation and asking for clarification
   e. Call finish_fix_group(groupId) — this is the ONLY way to commit your changes
      - If the group contains ONLY praise, acknowledgements, or comments that need no code
        changes: call finish_fix_group(groupId, no_changes: true) — this skips the git
        commit entirely. Do NOT create an empty commit for these groups.
4. Call finish_solving when all groups are done

CRITICAL — DO NOT use git directly:
- NEVER run git add, git commit, or any git command to stage or commit changes
- finish_fix_group is the ONLY tool that commits — it stages your changes, creates the commit,
  and records the result in the tracking system
- If you commit manually with git, the tracking system will not know about your commit and the
  group will remain stuck as "pending" — the user will never see your work
- This applies to every group, every time — always call finish_fix_group, never git commit
`;
}
