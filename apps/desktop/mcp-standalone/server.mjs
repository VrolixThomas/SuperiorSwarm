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

if (!REVIEW_DRAFT_ID || !DB_PATH) {
	console.error("Missing required env vars: REVIEW_DRAFT_ID, DB_PATH");
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
		db.prepare(`UPDATE review_drafts SET summary_markdown = ?, updated_at = ? WHERE id = ?`).run(
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
				content: [{ type: "text", text: JSON.stringify({ error: "Previous comment not found" }) }],
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
				content: [{ type: "text", text: JSON.stringify({ error: "Previous comment not found" }) }],
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
			content: [{ type: "text", text: JSON.stringify({ id, resolution: "incorrectly-resolved" }) }],
		};
	}
);

// Start the server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("MCP server error:", err);
	process.exit(1);
});
