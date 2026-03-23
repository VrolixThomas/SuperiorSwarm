import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

// Configuration from environment variables
const REVIEW_DRAFT_ID = process.env.REVIEW_DRAFT_ID;
const PR_METADATA = JSON.parse(process.env.PR_METADATA || "{}");
const DB_PATH = process.env.DB_PATH;
const SOLVE_SESSION_ID = process.env.SOLVE_SESSION_ID;
const WORKTREE_PATH = process.env.WORKTREE_PATH;
const isSolverMode = !!SOLVE_SESSION_ID;

if (!isSolverMode && (!REVIEW_DRAFT_ID || !DB_PATH)) {
	console.error("Missing required env vars: REVIEW_DRAFT_ID or SOLVE_SESSION_ID, and DB_PATH");
	process.exit(1);
}
if (isSolverMode && !DB_PATH) {
	console.error("Missing required env var: DB_PATH");
	process.exit(1);
}

// Connect to SQLite with WAL mode and busy timeout for concurrent access
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

const server = new McpServer({
	name: "branchflux",
	version: "1.0.0",
});

if (!isSolverMode) {
	// Tool: get_pr_metadata
	server.tool("get_pr_metadata", "Get metadata about the PR being reviewed", {}, async () => {
		return {
			content: [{ type: "text", text: JSON.stringify(PR_METADATA, null, 2) }],
		};
	});

	// Tool: add_draft_comment
	server.tool(
		"add_draft_comment",
		"Add an inline draft review comment on a specific file and line",
		{
			file_path: z.string().describe("Relative file path in the repository"),
			line_number: z
				.number()
				.optional()
				.describe("Line number for inline comment, omit for file-level"),
			side: z
				.enum(["LEFT", "RIGHT"])
				.optional()
				.describe("Diff side: LEFT for removed, RIGHT for added"),
			body: z.string().describe("Comment content in markdown"),
		},
		async ({ file_path, line_number, side, body }) => {
			const id = randomUUID();
			const now = Math.floor(Date.now() / 1000);

			db.prepare(
				`INSERT INTO draft_comments (id, review_draft_id, file_path, line_number, side, body, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
			).run(id, REVIEW_DRAFT_ID, file_path, line_number ?? null, side ?? null, body, now);

			return {
				content: [{ type: "text", text: JSON.stringify({ id, status: "pending" }) }],
			};
		}
	);

	// Tool: set_review_summary
	server.tool(
		"set_review_summary",
		"Write the overall PR review summary in markdown",
		{
			markdown: z.string().describe("Full review summary in markdown format"),
		},
		async ({ markdown }) => {
			const now = Math.floor(Date.now() / 1000);
			db.prepare("UPDATE review_drafts SET summary_markdown = ?, updated_at = ? WHERE id = ?").run(
				markdown,
				now,
				REVIEW_DRAFT_ID
			);

			return {
				content: [{ type: "text", text: JSON.stringify({ status: "saved" }) }],
			};
		}
	);

	// Tool: finish_review
	server.tool(
		"finish_review",
		"Signal that the review is complete. Call this after adding all comments and the summary.",
		{},
		async () => {
			const now = Math.floor(Date.now() / 1000);

			// Count draft comments
			const countResult = db
				.prepare("SELECT COUNT(*) as count FROM draft_comments WHERE review_draft_id = ?")
				.get(REVIEW_DRAFT_ID);

			// Check if summary was saved
			const draft = db
				.prepare("SELECT summary_markdown FROM review_drafts WHERE id = ?")
				.get(REVIEW_DRAFT_ID);

			// Update status to ready
			db.prepare("UPDATE review_drafts SET status = 'ready', updated_at = ? WHERE id = ?").run(
				now,
				REVIEW_DRAFT_ID
			);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							status: "ready",
							draft_count: countResult?.count ?? 0,
							summary_saved: !!draft?.summary_markdown,
						}),
					},
				],
			};
		}
	);

	// Tool: get_previous_comments
	server.tool(
		"get_previous_comments",
		"Get all comments from the previous review round with their resolution status",
		{},
		async () => {
			const currentDraft = db
				.prepare("SELECT previous_draft_id FROM review_drafts WHERE id = ?")
				.get(REVIEW_DRAFT_ID);

			if (!currentDraft?.previous_draft_id) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ comments: [], message: "No previous review round" }),
						},
					],
				};
			}

			const previousComments = db
				.prepare(
					"SELECT id, file_path, line_number, side, body, status, platform_comment_id, resolution FROM draft_comments WHERE review_draft_id = ?"
				)
				.all(currentDraft.previous_draft_id);

			const result = previousComments.map((c) => ({
				id: c.id,
				filePath: c.file_path,
				lineNumber: c.line_number,
				side: c.side,
				body: c.body,
				status: c.status,
				platformCommentId: c.platform_comment_id,
				platformStatus: c.resolution ?? "open",
			}));

			return {
				content: [{ type: "text", text: JSON.stringify({ comments: result }) }],
			};
		}
	);

	// Tool: resolve_comment
	server.tool(
		"resolve_comment",
		"Mark a previous review comment as resolved by new code",
		{
			previous_comment_id: z.string().describe("The ID of the previous comment being resolved"),
			reason: z.string().describe("Explanation of how the new code resolves this comment"),
		},
		async ({ previous_comment_id, reason }) => {
			const prevComment = db
				.prepare("SELECT file_path, line_number, side FROM draft_comments WHERE id = ?")
				.get(previous_comment_id);

			if (!prevComment) {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: "Previous comment not found" }) },
					],
				};
			}

			const id = randomUUID();
			const now = Math.floor(Date.now() / 1000);

			db.prepare(
				`INSERT INTO draft_comments (id, review_draft_id, file_path, line_number, side, body, status, previous_comment_id, resolution, resolution_reason, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'resolved-by-code', ?, ?)`
			).run(
				id,
				REVIEW_DRAFT_ID,
				prevComment.file_path,
				prevComment.line_number,
				prevComment.side,
				`Resolved: ${reason}`,
				previous_comment_id,
				reason,
				now
			);

			return {
				content: [{ type: "text", text: JSON.stringify({ id, resolution: "resolved-by-code" }) }],
			};
		}
	);

	// Tool: flag_comment
	server.tool(
		"flag_comment",
		"Flag a previous comment that was resolved by the author but the fix appears incorrect",
		{
			previous_comment_id: z.string().describe("The ID of the previous comment being flagged"),
			reason: z
				.string()
				.describe("Explanation of why the author's resolution is incorrect or incomplete"),
		},
		async ({ previous_comment_id, reason }) => {
			const prevComment = db
				.prepare("SELECT file_path, line_number, side FROM draft_comments WHERE id = ?")
				.get(previous_comment_id);

			if (!prevComment) {
				return {
					content: [
						{ type: "text", text: JSON.stringify({ error: "Previous comment not found" }) },
					],
				};
			}

			const id = randomUUID();
			const now = Math.floor(Date.now() / 1000);

			db.prepare(
				`INSERT INTO draft_comments (id, review_draft_id, file_path, line_number, side, body, status, previous_comment_id, resolution, resolution_reason, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'incorrectly-resolved', ?, ?)`
			).run(
				id,
				REVIEW_DRAFT_ID,
				prevComment.file_path,
				prevComment.line_number,
				prevComment.side,
				`Flagged: ${reason}`,
				previous_comment_id,
				reason,
				now
			);

			return {
				content: [
					{ type: "text", text: JSON.stringify({ id, resolution: "incorrectly-resolved" }) },
				],
			};
		}
	);
}

if (isSolverMode) {
	// Tool: get_pr_comments
	server.tool(
		"get_pr_comments",
		"Get all open PR comments for the current solve session",
		{},
		async () => {
			const comments = db
				.prepare(
					`SELECT id, platform_comment_id, author, body, file_path, line_number, side, thread_id, commit_sha
					 FROM pr_comments
					 WHERE solve_session_id = ? AND status = 'open'`
				)
				.all(SOLVE_SESSION_ID);

			const result = comments.map((c) => ({
				id: c.id,
				platformCommentId: c.platform_comment_id,
				author: c.author,
				body: c.body,
				filePath: c.file_path,
				lineNumber: c.line_number,
				side: c.side,
				threadId: c.thread_id,
				commitSha: c.commit_sha,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify({ comments: result }) }],
			};
		}
	);

	// Tool: submit_grouping
	server.tool(
		"submit_grouping",
		"Submit a grouping of comments into named groups for batch fixing",
		{
			groups: z.array(
				z.object({
					label: z.string().describe("Name/description for this group of comments"),
					comment_ids: z.array(z.string()).describe("Array of comment IDs in this group"),
				})
			),
		},
		async ({ groups }) => {
			const insertGroup = db.prepare(
				`INSERT INTO comment_groups (id, solve_session_id, label, status, "order")
				 VALUES (?, ?, ?, 'pending', ?)`
			);
			const updateComment = db.prepare(
				"UPDATE pr_comments SET group_id = ? WHERE id = ? AND solve_session_id = ?"
			);

			const transaction = db.transaction((groups) => {
				const groupIds = [];
				for (let i = 0; i < groups.length; i++) {
					const group = groups[i];
					const groupId = randomUUID();
					insertGroup.run(groupId, SOLVE_SESSION_ID, group.label, i);
					for (const commentId of group.comment_ids) {
						updateComment.run(groupId, commentId, SOLVE_SESSION_ID);
					}
					groupIds.push({ groupId, label: group.label, commentCount: group.comment_ids.length });
				}
				return groupIds;
			});

			const groupIds = transaction(groups);

			return {
				content: [{ type: "text", text: JSON.stringify({ status: "ok", groups: groupIds }) }],
			};
		}
	);

	// Tool: start_fix_group
	server.tool(
		"start_fix_group",
		"Get the details of a comment group to start fixing it",
		{
			group_id: z.string().describe("The ID of the comment group to fix"),
		},
		async ({ group_id }) => {
			const group = db
				.prepare("SELECT label FROM comment_groups WHERE id = ? AND solve_session_id = ?")
				.get(group_id, SOLVE_SESSION_ID);

			if (!group) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "Group not found" }) }],
				};
			}

			const comments = db
				.prepare(
					`SELECT id, author, body, file_path, line_number, side, thread_id
					 FROM pr_comments
					 WHERE group_id = ? AND solve_session_id = ?`
				)
				.all(group_id, SOLVE_SESSION_ID);

			const result = comments.map((c) => ({
				id: c.id,
				author: c.author,
				body: c.body,
				filePath: c.file_path,
				lineNumber: c.line_number,
				side: c.side,
				threadId: c.thread_id,
			}));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ groupId: group_id, label: group.label, comments: result }),
					},
				],
			};
		}
	);

	// Tool: mark_comment_fixed
	server.tool(
		"mark_comment_fixed",
		"Mark a specific PR comment as fixed",
		{
			comment_id: z.string().describe("The ID of the comment to mark as fixed"),
		},
		async ({ comment_id }) => {
			const result = db
				.prepare(`UPDATE pr_comments SET status = 'fixed' WHERE id = ? AND solve_session_id = ?`)
				.run(comment_id, SOLVE_SESSION_ID);

			if (result.changes === 0) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "Comment not found" }) }],
				};
			}

			return {
				content: [{ type: "text", text: JSON.stringify({ status: "fixed", comment_id }) }],
			};
		}
	);

	// Tool: mark_comment_unclear
	server.tool(
		"mark_comment_unclear",
		"Mark a comment as unclear and draft a reply asking for clarification",
		{
			comment_id: z.string().describe("The ID of the comment to mark as unclear"),
			reply_body: z.string().describe("The reply body to send to the comment author"),
		},
		async ({ comment_id, reply_body }) => {
			const transaction = db.transaction((commentId, replyBody) => {
				db.prepare(
					`UPDATE pr_comments SET status = 'unclear' WHERE id = ? AND solve_session_id = ?`
				).run(commentId, SOLVE_SESSION_ID);

				const replyId = randomUUID();
				db.prepare(
					`INSERT INTO comment_replies (id, pr_comment_id, body, status)
					 VALUES (?, ?, ?, 'draft')`
				).run(replyId, commentId, replyBody);

				return replyId;
			});

			const replyId = transaction(comment_id, reply_body);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ status: "unclear", comment_id, reply_id: replyId }),
					},
				],
			};
		}
	);

	// Tool: finish_fix_group
	server.tool(
		"finish_fix_group",
		"Commit the changes for a fix group and mark it as complete",
		{
			group_id: z.string().describe("The ID of the comment group that has been fixed"),
		},
		async ({ group_id }) => {
			try {
				const group = db
					.prepare("SELECT label FROM comment_groups WHERE id = ? AND solve_session_id = ?")
					.get(group_id, SOLVE_SESSION_ID);

				if (!group) {
					return {
						content: [{ type: "text", text: JSON.stringify({ error: "Group not found" }) }],
						isError: true,
					};
				}

				const cwd = WORKTREE_PATH || process.cwd();
				const label = group.label.replace(/"/g, '\\"');

				execSync("git add -A", { cwd });

				for (const path of [".mcp.json", ".gemini/", "opencode.json", ".codex/"]) {
					try {
						execSync(`git reset HEAD "${path}"`, { cwd });
					} catch {
						// Ignore errors — file may not exist or not be staged
					}
				}

				execSync(`git commit -m "fix: ${label}"`, { cwd });

				const hashOutput = execSync("git rev-parse HEAD", { cwd });
				const hash = hashOutput.toString().trim();
				const shortHash = hash.slice(0, 7);

				const now = Math.floor(Date.now() / 1000);
				db.prepare(
					`UPDATE comment_groups SET status = 'fixed', commit_hash = ? WHERE id = ? AND solve_session_id = ?`
				).run(hash, group_id, SOLVE_SESSION_ID);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "fixed",
								group_id,
								commit: shortHash,
								message: `fix: ${group.label}`,
							}),
						},
					],
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }],
					isError: true,
				};
			}
		}
	);

	// Tool: finish_solving
	server.tool(
		"finish_solving",
		"Signal that all comments have been processed and the solve session is complete",
		{},
		async () => {
			const now = Math.floor(Date.now() / 1000);

			db.prepare(
				`UPDATE comment_solve_sessions SET status = 'ready', updated_at = ? WHERE id = ?`
			).run(now, SOLVE_SESSION_ID);

			return {
				content: [{ type: "text", text: JSON.stringify({ status: "ready" }) }],
			};
		}
	);
}

// Start the server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("MCP server error:", err);
	process.exit(1);
});
