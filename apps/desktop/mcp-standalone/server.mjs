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
		db.prepare(
			`UPDATE review_drafts SET summary_markdown = ?, updated_at = ? WHERE id = ?`
		).run(markdown, now, REVIEW_DRAFT_ID);

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

// Start the server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("MCP server error:", err);
	process.exit(1);
});
