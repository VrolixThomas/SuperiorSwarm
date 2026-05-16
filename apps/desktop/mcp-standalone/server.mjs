import { execFileSync } from "node:child_process";
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
const QUICK_ACTION_SETUP = process.env.QUICK_ACTION_SETUP;
const PROJECT_ID = process.env.PROJECT_ID;
const WORKSPACE_ID = process.env.WORKSPACE_ID;
const isSolverMode = !!SOLVE_SESSION_ID;
const isQuickActionMode = QUICK_ACTION_SETUP === "1";
const SUPERIORSWARM_CONTROL_PORT = process.env.SUPERIORSWARM_CONTROL_PORT;
const SUPERIORSWARM_CONTROL_TOKEN = process.env.SUPERIORSWARM_CONTROL_TOKEN;
const isWorkspaceAgentMode = process.env.WORKSPACE_AGENT === "1";
const MEMORY_ROOT = process.env.MEMORY_ROOT;

if (
	isWorkspaceAgentMode &&
	(!PROJECT_ID || !WORKSPACE_ID || !SUPERIORSWARM_CONTROL_PORT || !SUPERIORSWARM_CONTROL_TOKEN)
) {
	console.error(
		"WORKSPACE_AGENT mode requires PROJECT_ID, WORKSPACE_ID, SUPERIORSWARM_CONTROL_PORT, SUPERIORSWARM_CONTROL_TOKEN"
	);
	process.exit(1);
}

if (
	!isWorkspaceAgentMode &&
	!isQuickActionMode &&
	!isSolverMode &&
	(!REVIEW_DRAFT_ID || !DB_PATH)
) {
	console.error("Missing required env vars: REVIEW_DRAFT_ID or SOLVE_SESSION_ID, and DB_PATH");
	process.exit(1);
}
if (!isWorkspaceAgentMode && (isSolverMode || isQuickActionMode) && !DB_PATH) {
	console.error("Missing required env var: DB_PATH");
	process.exit(1);
}

// Connect to SQLite with WAL mode and busy timeout for concurrent access
let db = null;
if (isWorkspaceAgentMode) {
	if (!DB_PATH || !MEMORY_ROOT) {
		console.error(
			"WORKSPACE_AGENT mode requires DB_PATH and MEMORY_ROOT for memory tools"
		);
		process.exit(1);
	}
	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("foreign_keys = ON");
} else {
	db = new Database(DB_PATH);
	db.pragma("journal_mode = WAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("foreign_keys = ON");
}

const server = new McpServer({
	name: "superiorswarm",
	version: "1.0.0",
});

if (!isSolverMode && !isQuickActionMode && !isWorkspaceAgentMode) {
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

function heartbeatSession(sessionId) {
	if (!sessionId) return;
	db.prepare("UPDATE comment_solve_sessions SET last_activity_at = ? WHERE id = ?").run(
		Math.floor(Date.now() / 1000),
		sessionId
	);
}

if (isSolverMode) {
	// Tool: get_pr_comments
	server.tool(
		"get_pr_comments",
		"Get all open PR comments for the current solve session",
		{},
		async () => {
			heartbeatSession(SOLVE_SESSION_ID);
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
			heartbeatSession(SOLVE_SESSION_ID);
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
			heartbeatSession(SOLVE_SESSION_ID);
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
			heartbeatSession(SOLVE_SESSION_ID);
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
			heartbeatSession(SOLVE_SESSION_ID);
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
		"Commit the changes for a fix group and mark it as complete. Use this after making code changes. For groups that need no code changes (praise, acknowledgements), use acknowledge_group instead.",
		{
			group_id: z.string().describe("The ID of the comment group that has been fixed"),
		},
		async ({ group_id }) => {
			try {
				heartbeatSession(SOLVE_SESSION_ID);
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

				execFileSync("git", ["add", "-A"], { cwd });

				for (const path of [".mcp.json", ".gemini/", "opencode.json", ".codex/"]) {
					try {
						execFileSync("git", ["reset", "HEAD", path], { cwd });
					} catch {
						// Ignore errors — file may not exist or not be staged
					}
				}

				try {
					execFileSync("git", ["commit", "-m", `fix: ${group.label}`], { cwd });
				} catch (commitErr) {
					// Agent may have already committed manually — if there's genuinely nothing
					// to commit, fall through and use the current HEAD as the commit hash.
					const msg = String(commitErr);
					const nothingToCommit =
						msg.includes("nothing to commit") || msg.includes("nothing added to commit");
					if (!nothingToCommit) throw commitErr;
				}

				const hashOutput = execFileSync("git", ["rev-parse", "HEAD"], { cwd });
				const hash = hashOutput.toString().trim();
				const shortHash = hash.slice(0, 7);

				db.prepare(
					`UPDATE comment_groups SET status = 'fixed', commit_hash = ? WHERE id = ? AND solve_session_id = ?`
				).run(hash, group_id, SOLVE_SESSION_ID);

				const diffTree = execFileSync(
					"git",
					["diff-tree", "--no-commit-id", "-r", "--numstat", hash],
					{ cwd }
				)
					.toString()
					.trim();

				const changedFiles = diffTree
					? diffTree
							.split("\n")
							.filter(Boolean)
							.map((line) => {
								const [add, del, path] = line.split("\t");
								return {
									path,
									changeType: "M",
									additions: add === "-" ? 0 : Number.parseInt(add, 10),
									deletions: del === "-" ? 0 : Number.parseInt(del, 10),
								};
							})
					: [];

				const nameStatus = execFileSync(
					"git",
					["diff-tree", "--no-commit-id", "-r", "--name-status", hash],
					{ cwd }
				)
					.toString()
					.trim();

				const typeMap = {};
				for (const line of nameStatus.split("\n").filter(Boolean)) {
					const [type, ...pathParts] = line.split("\t");
					const filePath = pathParts[pathParts.length - 1];
					typeMap[filePath] = type.charAt(0);
				}

				for (const file of changedFiles) {
					file.changeType = typeMap[file.path] || "M";
				}

				db.prepare("UPDATE comment_groups SET changed_files = ? WHERE id = ?").run(
					JSON.stringify(changedFiles),
					group_id
				);

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

	// Tool: acknowledge_group
	server.tool(
		"acknowledge_group",
		"Mark a group as complete without creating a commit. Use this when all comments in the group are praise, acknowledgements, or items that need no code changes.",
		{
			group_id: z.string().describe("The ID of the comment group to acknowledge"),
		},
		async ({ group_id }) => {
			try {
				heartbeatSession(SOLVE_SESSION_ID);
				const group = db
					.prepare("SELECT label FROM comment_groups WHERE id = ? AND solve_session_id = ?")
					.get(group_id, SOLVE_SESSION_ID);

				if (!group) {
					return {
						content: [{ type: "text", text: JSON.stringify({ error: "Group not found" }) }],
						isError: true,
					};
				}

				db.prepare(
					`UPDATE comment_groups SET status = 'fixed', commit_hash = NULL, changed_files = '[]' WHERE id = ? AND solve_session_id = ?`
				).run(group_id, SOLVE_SESSION_ID);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "fixed",
								group_id,
								message: "Group acknowledged — no code changes",
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
			heartbeatSession(SOLVE_SESSION_ID);
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

if (isQuickActionMode) {
	// Tool: add_quick_action
	server.tool(
		"add_quick_action",
		"Add a quick action button to the top bar. Provide a short label, the shell command to run, and optionally a subdirectory and scope.",
		{
			label: z.string().describe("Short button label (e.g. 'Build', 'Test')"),
			command: z.string().describe("Shell command to execute"),
			cwd: z.string().optional().describe("Relative subdirectory to run in (optional)"),
			shortcut: z
				.string()
				.optional()
				.describe("Keyboard shortcut in Electron accelerator format (optional)"),
			scope: z
				.enum(["global", "repo"])
				.optional()
				.describe("Whether this action applies globally or only to this repo"),
		},
		async ({ label, command, cwd, shortcut, scope }) => {
			const id = randomUUID();
			const now = Math.floor(Date.now() / 1000);
			const projectId = scope === "global" ? null : (PROJECT_ID ?? null);

			const countResult = db
				.prepare(
					"SELECT COUNT(*) as count FROM quick_actions WHERE project_id = ? OR project_id IS NULL"
				)
				.get(projectId);
			const sortOrder = countResult?.count ?? 0;

			db.prepare(
				`INSERT INTO quick_actions (id, project_id, label, command, cwd, shortcut, sort_order, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			).run(id, projectId, label, command, cwd ?? null, shortcut ?? null, sortOrder, now, now);

			return {
				content: [{ type: "text", text: JSON.stringify({ id, status: "created" }) }],
			};
		}
	);

	// Tool: list_quick_actions
	server.tool(
		"list_quick_actions",
		"List all currently configured quick action buttons",
		{},
		async () => {
			const actions = db
				.prepare(
					`SELECT id, project_id, label, command, cwd, shortcut, sort_order
					 FROM quick_actions
					 WHERE project_id = ? OR project_id IS NULL
					 ORDER BY sort_order ASC`
				)
				.all(PROJECT_ID ?? null);

			if (actions.length === 0) {
				return {
					content: [{ type: "text", text: "No quick actions configured." }],
				};
			}

			const lines = actions.map((a) => {
				const scope = a.project_id ? "repo" : "global";
				const parts = [`[${a.id}] ${a.label} — ${a.command} (${scope})`];
				if (a.cwd) parts.push(`  cwd: ${a.cwd}`);
				if (a.shortcut) parts.push(`  shortcut: ${a.shortcut}`);
				return parts.join("\n");
			});

			return {
				content: [{ type: "text", text: lines.join("\n\n") }],
			};
		}
	);

	// Tool: remove_quick_action
	server.tool(
		"remove_quick_action",
		"Remove a quick action by its ID",
		{
			id: z.string().describe("The ID of the quick action to remove"),
		},
		async ({ id }) => {
			const result = db.prepare("DELETE FROM quick_actions WHERE id = ?").run(id);

			if (result.changes === 0) {
				return {
					content: [{ type: "text", text: JSON.stringify({ error: "Quick action not found" }) }],
				};
			}

			return {
				content: [{ type: "text", text: JSON.stringify({ status: "removed", id }) }],
			};
		}
	);
}

if (isWorkspaceAgentMode) {
	const baseUrl = `http://127.0.0.1:${SUPERIORSWARM_CONTROL_PORT}`;
	const authHeader = `Bearer ${SUPERIORSWARM_CONTROL_TOKEN}`;

	async function call(method, path, body) {
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				method,
				headers: {
					Authorization: authHeader,
					"X-Workspace-Id": WORKSPACE_ID,
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
			});
			const text = await res.text();
			let parsed;
			try {
				parsed = text ? JSON.parse(text) : {};
			} catch {
				parsed = { raw: text };
			}
			if (!res.ok) {
				return {
					content: [{ type: "text", text: JSON.stringify({ status: res.status, ...parsed }) }],
					isError: true,
				};
			}
			return { content: [{ type: "text", text: JSON.stringify(parsed) }] };
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `control plane unreachable — is SuperiorSwarm running? (${err && err.message ? err.message : String(err)})`,
					},
				],
				isError: true,
			};
		}
	}

	server.tool(
		"create_worktree",
		"Create a new app-managed worktree for a new branch. The new worktree gets its own .mcp.json so child agents inherit the same control plane.",
		{
			branch: z.string().describe("Branch name to create"),
			base_branch: z
				.string()
				.optional()
				.describe("Branch to fork from. Defaults to project default branch."),
		},
		async ({ branch, base_branch }) =>
			call("POST", "/workspaces.create", {
				projectId: PROJECT_ID,
				branch,
				baseBranch: base_branch,
			})
	);

	server.tool(
		"list_workspaces",
		"List all workspaces (worktrees and review sessions) in the current project.",
		{},
		async () => call("GET", `/workspaces.list?projectId=${encodeURIComponent(PROJECT_ID)}`)
	);

	server.tool(
		"get_workspace",
		"Get details about a specific workspace, including whether it has uncommitted changes.",
		{ workspace_id: z.string().describe("Workspace ID") },
		async ({ workspace_id }) =>
			call(
				"GET",
				`/workspaces.get?projectId=${encodeURIComponent(PROJECT_ID)}&workspaceId=${encodeURIComponent(workspace_id)}`
			)
	);

	server.tool(
		"dispatch_agent",
		"Open a terminal in the target workspace and run the configured CLI agent with a prompt. User must approve via app modal.",
		{
			workspace_id: z.string().describe("Workspace ID to dispatch into"),
			prompt: z.string().describe("Prompt to send to the CLI agent"),
			cli_preset: z.enum(["claude", "codex", "gemini", "opencode"]).optional(),
			skip_permissions: z.boolean().optional(),
		},
		async ({ workspace_id, prompt, cli_preset, skip_permissions }) =>
			call("POST", "/workspaces.dispatch", {
				projectId: PROJECT_ID,
				workspaceId: workspace_id,
				prompt,
				cliPreset: cli_preset,
				skipPermissions: skip_permissions,
			})
	);

	server.tool(
		"remove_worktree",
		"Remove a worktree and its workspace. User must approve via app modal. Set force=true to bypass uncommitted-changes guard.",
		{
			workspace_id: z.string().describe("Workspace ID to remove"),
			force: z.boolean().optional().describe("Bypass uncommitted-changes guard"),
		},
		async ({ workspace_id, force }) =>
			call("POST", "/workspaces.remove", {
				projectId: PROJECT_ID,
				workspaceId: workspace_id,
				force,
			})
	);

	server.tool(
		"set_status",
		"Publish this workspace's current phase + optional status text and needs. Other agents and the user can see this. Phase is one of: idle, working, blocked, done.",
		{
			phase: z.enum(["idle", "working", "blocked", "done"]),
			status_text: z.string().max(2000).optional(),
			needs: z.string().max(2000).optional(),
		},
		async ({ phase, status_text, needs }) =>
			call("POST", "/workspaces.set_status", {
				phase,
				statusText: status_text,
				needs,
			})
	);

	server.tool(
		"send_message",
		"Send a durable message to another workspace in this project, or broadcast to all. The recipient sees it via read_messages. The orchestrator agent also sees broadcasts and direct messages via its watch stream.",
		{
			to_workspace_id: z.string().optional().describe("Omit for broadcast"),
			kind: z.enum(["note", "question", "answer"]),
			content: z.string().min(1).max(8192),
			in_reply_to: z.string().optional(),
		},
		async ({ to_workspace_id, kind, content, in_reply_to }) =>
			call("POST", "/workspaces.send_message", {
				toWorkspaceId: to_workspace_id,
				kind,
				content,
				inReplyTo: in_reply_to,
			})
	);

	server.tool(
		"read_messages",
		"Read messages directed at this workspace (and project-wide broadcasts unless excluded). Returns the most recent up to 200 messages.",
		{
			since: z.string().optional().describe("ISO timestamp; default = last 1 hour"),
			include_broadcasts: z.boolean().optional(),
		},
		async ({ since, include_broadcasts }) => {
			const params = new URLSearchParams({ projectId: PROJECT_ID });
			if (since) params.set("since", since);
			if (include_broadcasts === false) params.set("includeBroadcasts", "false");
			return call("GET", `/workspaces.read_messages?${params.toString()}`);
		}
	);

	server.tool(
		"resume_agent",
		"(Orchestrator-only) Wake another agent in this project by sending it a follow-up message. The control plane runs `claude --resume` in the target workspace's terminal.",
		{
			workspace_id: z.string(),
			message: z.string().min(1).max(8192),
		},
		async ({ workspace_id, message }) =>
			call("POST", "/workspaces.resume_agent", {
				workspaceId: workspace_id,
				message,
			})
	);

	// Memory tools
	{
		const fs = require("node:fs");
		const path = require("node:path");

		function nowS() {
			return Math.floor(Date.now() / 1000);
		}

		function memoryRoot() {
			return path.join(MEMORY_ROOT, "memory");
		}
		function projectRoot(pid) {
			return path.join(memoryRoot(), pid);
		}
		function journalDir(pid) {
			return path.join(projectRoot(pid), "journal");
		}

		function ftsUpsert(kind, refId, projectId, body) {
			db.prepare(
				"DELETE FROM memory_fts WHERE kind = ? AND ref_id = ?"
			).run(kind, refId);
			db.prepare(
				"INSERT INTO memory_fts (kind, ref_id, project_id, body) VALUES (?, ?, ?, ?)"
			).run(kind, refId, projectId, body);
		}

		// add_goal
		server.tool(
			"memory_add_goal",
			"Add a project goal to long-lived orchestrator memory",
			{
				title: z.string(),
				body: z.string().optional(),
			},
			async ({ title, body }) => {
				const id = `goal_${randomUUID().slice(0, 12)}`;
				const now = nowS();
				db.prepare(
					`INSERT INTO memory_goals (id, project_id, title, body, status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, 'active', ?, ?)`
				).run(id, PROJECT_ID, title, body ?? null, now, now);
				ftsUpsert("goal", id, PROJECT_ID, body ? `${title}\n\n${body}` : title);
				return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
			}
		);

		// list_goals
		server.tool(
			"memory_list_goals",
			"List project goals",
			{
				status: z.enum(["active", "done", "abandoned"]).optional(),
			},
			async ({ status }) => {
				const rows = status
					? db
							.prepare(
								"SELECT * FROM memory_goals WHERE project_id = ? AND status = ? ORDER BY created_at DESC"
							)
							.all(PROJECT_ID, status)
					: db
							.prepare(
								"SELECT * FROM memory_goals WHERE project_id = ? ORDER BY created_at DESC"
							)
							.all(PROJECT_ID);
				return { content: [{ type: "text", text: JSON.stringify(rows) }] };
			}
		);

		// add_followup
		server.tool(
			"memory_add_followup",
			"Add a follow-up item",
			{
				title: z.string(),
				body: z.string().optional(),
				owner: z.string().optional(),
				due_at: z.number().optional().describe("unix seconds"),
				goal_id: z.string().optional(),
			},
			async ({ title, body, owner, due_at, goal_id }) => {
				const id = `fu_${randomUUID().slice(0, 12)}`;
				const now = nowS();
				db.prepare(
					`INSERT INTO memory_followups (id, project_id, goal_id, title, body, owner, due_at, status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
				).run(
					id,
					PROJECT_ID,
					goal_id ?? null,
					title,
					body ?? null,
					owner ?? null,
					due_at ?? null,
					now,
					now
				);
				return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
			}
		);

		// list_followups
		server.tool(
			"memory_list_followups",
			"List follow-ups with optional filters",
			{
				status: z.enum(["open", "done", "cancelled"]).optional(),
				owner: z.string().optional(),
				due_before: z.number().optional(),
				due_after: z.number().optional(),
			},
			async ({ status, owner, due_before, due_after }) => {
				const where = ["project_id = ?"];
				const params = [PROJECT_ID];
				if (status) {
					where.push("status = ?");
					params.push(status);
				}
				if (owner) {
					where.push("owner = ?");
					params.push(owner);
				}
				if (due_before !== undefined) {
					where.push("due_at < ?");
					params.push(due_before);
				}
				if (due_after !== undefined) {
					where.push("due_at > ?");
					params.push(due_after);
				}
				const rows = db
					.prepare(
						`SELECT * FROM memory_followups WHERE ${where.join(
							" AND "
						)} ORDER BY due_at ASC, created_at ASC`
					)
					.all(...params);
				return { content: [{ type: "text", text: JSON.stringify(rows) }] };
			}
		);

		// log_decision
		server.tool(
			"memory_log_decision",
			"Record a decision and its rationale",
			{
				title: z.string(),
				rationale: z.string(),
				alternatives: z.string().optional(),
			},
			async ({ title, rationale, alternatives }) => {
				const id = `dec_${randomUUID().slice(0, 12)}`;
				const now = nowS();
				db.prepare(
					`INSERT INTO memory_decisions (id, project_id, title, rationale, alternatives, created_at)
					 VALUES (?, ?, ?, ?, ?, ?)`
				).run(id, PROJECT_ID, title, rationale, alternatives ?? null, now);
				const body = [title, rationale, alternatives ?? ""]
					.filter(Boolean)
					.join("\n\n");
				ftsUpsert("decision", id, PROJECT_ID, body);
				return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
			}
		);

		// add_question
		server.tool(
			"memory_add_question",
			"Record an open question",
			{
				question: z.string(),
				context: z.string().optional(),
			},
			async ({ question, context }) => {
				const id = `q_${randomUUID().slice(0, 12)}`;
				const now = nowS();
				db.prepare(
					`INSERT INTO memory_open_questions (id, project_id, question, context, status, created_at)
					 VALUES (?, ?, ?, ?, 'open', ?)`
				).run(id, PROJECT_ID, question, context ?? null, now);
				ftsUpsert(
					"question",
					id,
					PROJECT_ID,
					[question, context ?? ""].filter(Boolean).join("\n\n")
				);
				return { content: [{ type: "text", text: JSON.stringify({ id }) }] };
			}
		);

		// answer_question
		server.tool(
			"memory_answer_question",
			"Mark an open question answered",
			{
				id: z.string(),
				answer: z.string(),
			},
			async ({ id, answer }) => {
				const row = db
					.prepare("SELECT * FROM memory_open_questions WHERE id = ?")
					.get(id);
				if (!row) throw new Error(`question not found: ${id}`);
				db.prepare(
					`UPDATE memory_open_questions
					    SET answer = ?, status = 'answered', answered_at = ?
					  WHERE id = ?`
				).run(answer, nowS(), id);
				ftsUpsert(
					"question",
					id,
					row.project_id,
					[row.question, row.context ?? "", answer].filter(Boolean).join("\n\n")
				);
				return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
			}
		);

		// journal_start
		server.tool(
			"memory_journal_start",
			"Open a new journal session and return its session id and file path",
			{},
			async () => {
				const sessionId = `sess_${randomUUID().slice(0, 12)}`;
				const startedAt = new Date();
				const dir = journalDir(PROJECT_ID);
				fs.mkdirSync(dir, { recursive: true });
				const yyyy = startedAt.getUTCFullYear();
				const mm = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
				const dd = String(startedAt.getUTCDate()).padStart(2, "0");
				const hh = String(startedAt.getUTCHours()).padStart(2, "0");
				const mi = String(startedAt.getUTCMinutes()).padStart(2, "0");
				const ss = String(startedAt.getUTCSeconds()).padStart(2, "0");
				const filePath = path.join(
					dir,
					`${yyyy}-${mm}-${dd}-${hh}${mi}${ss}-${sessionId}.md`
				);
				fs.writeFileSync(
					filePath,
					`# Session ${startedAt.toISOString()} (${sessionId})\n\n`,
					"utf-8"
				);
				db.prepare(
					`INSERT INTO memory_journal (id, project_id, session_id, file_path, started_at)
					 VALUES (?, ?, ?, ?, ?)`
				).run(sessionId, PROJECT_ID, sessionId, filePath, nowS());
				return {
					content: [
						{ type: "text", text: JSON.stringify({ session_id: sessionId, file_path: filePath }) },
					],
				};
			}
		);

		// journal_append
		server.tool(
			"memory_journal_append",
			"Append markdown text to an open journal session",
			{
				session_id: z.string(),
				text: z.string(),
			},
			async ({ session_id, text }) => {
				const row = db
					.prepare("SELECT * FROM memory_journal WHERE session_id = ?")
					.get(session_id);
				if (!row) throw new Error(`journal session not found: ${session_id}`);
				if (row.ended_at) throw new Error(`journal already ended: ${session_id}`);
				const withNl = text.endsWith("\n") ? text : `${text}\n`;
				fs.appendFileSync(row.file_path, withNl, "utf-8");
				return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
			}
		);

		// journal_end
		server.tool(
			"memory_journal_end",
			"Close a journal session, attach a summary, index FTS",
			{
				session_id: z.string(),
				summary: z.string(),
			},
			async ({ session_id, summary }) => {
				const row = db
					.prepare("SELECT * FROM memory_journal WHERE session_id = ?")
					.get(session_id);
				if (!row) throw new Error(`journal session not found: ${session_id}`);
				db.prepare(
					"UPDATE memory_journal SET ended_at = ?, summary = ? WHERE session_id = ?"
				).run(nowS(), summary, session_id);
				ftsUpsert("journal", session_id, row.project_id, summary);
				return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
			}
		);

		// recent_journals
		server.tool(
			"memory_recent_journals",
			"List recent journal index rows",
			{
				limit: z.number().optional(),
			},
			async ({ limit }) => {
				const rows = db
					.prepare(
						"SELECT * FROM memory_journal WHERE project_id = ? ORDER BY started_at DESC LIMIT ?"
					)
					.all(PROJECT_ID, limit ?? 20);
				return { content: [{ type: "text", text: JSON.stringify(rows) }] };
			}
		);

		// read_journal
		server.tool(
			"memory_read_journal",
			"Read the MD body of a journal session",
			{ session_id: z.string() },
			async ({ session_id }) => {
				const row = db
					.prepare("SELECT * FROM memory_journal WHERE session_id = ?")
					.get(session_id);
				if (!row) throw new Error(`journal session not found: ${session_id}`);
				const body = fs.readFileSync(row.file_path, "utf-8");
				return { content: [{ type: "text", text: body }] };
			}
		);

		// list_decisions
		server.tool(
			"memory_list_decisions",
			"List decisions, newest first",
			{ limit: z.number().optional(), since: z.number().optional() },
			async ({ limit, since }) => {
				const rows =
					since !== undefined
						? db
								.prepare(
									"SELECT * FROM memory_decisions WHERE project_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?"
								)
								.all(PROJECT_ID, since, limit ?? 100)
						: db
								.prepare(
									"SELECT * FROM memory_decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
								)
								.all(PROJECT_ID, limit ?? 100);
				return { content: [{ type: "text", text: JSON.stringify(rows) }] };
			}
		);

		// list_questions
		server.tool(
			"memory_list_questions",
			"List open questions",
			{ status: z.enum(["open", "answered", "stale"]).optional() },
			async ({ status }) => {
				const rows = status
					? db
							.prepare(
								"SELECT * FROM memory_open_questions WHERE project_id = ? AND status = ? ORDER BY created_at DESC"
							)
							.all(PROJECT_ID, status)
					: db
							.prepare(
								"SELECT * FROM memory_open_questions WHERE project_id = ? ORDER BY created_at DESC"
							)
							.all(PROJECT_ID);
				return { content: [{ type: "text", text: JSON.stringify(rows) }] };
			}
		);

		// search
		server.tool(
			"memory_search",
			"Full-text search across goals, decisions, questions, and journal summaries",
			{
				query: z.string(),
				kinds: z
					.array(z.enum(["goal", "decision", "question", "journal"]))
					.optional(),
				limit: z.number().optional(),
			},
			async ({ query, kinds, limit }) => {
				const kindFilter =
					kinds && kinds.length > 0
						? ` AND kind IN (${kinds.map(() => "?").join(",")})`
						: "";
				const params = [PROJECT_ID, query];
				if (kinds && kinds.length > 0) params.push(...kinds);
				params.push(limit ?? 50);
				const rows = db
					.prepare(
						`SELECT kind, ref_id, project_id,
						        snippet(memory_fts, 3, '[', ']', '...', 16) AS snippet,
						        bm25(memory_fts) AS rank
						   FROM memory_fts
						  WHERE project_id = ? AND memory_fts MATCH ?${kindFilter}
						  ORDER BY rank
						  LIMIT ?`
					)
					.all(...params);
				return { content: [{ type: "text", text: JSON.stringify(rows) }] };
			}
		);
	}
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
