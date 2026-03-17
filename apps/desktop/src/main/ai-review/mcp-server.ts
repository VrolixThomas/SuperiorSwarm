import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import { draftComments, reviewDrafts } from "../db/schema-ai-review";

// Configuration from environment variables
const REVIEW_DRAFT_ID = process.env.REVIEW_DRAFT_ID!;
const PR_METADATA = JSON.parse(process.env.PR_METADATA!);
const DB_PATH = process.env.DB_PATH!;

// Connect to SQLite with WAL mode and busy timeout for concurrent access
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite);

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
		const now = new Date();

		db.insert(draftComments)
			.values({
				id,
				reviewDraftId: REVIEW_DRAFT_ID,
				filePath: file_path,
				lineNumber: line_number ?? null,
				side: side ?? null,
				body,
				status: "pending",
				createdAt: now,
			})
			.run();

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
		const now = new Date();
		db.update(reviewDrafts)
			.set({
				summaryMarkdown: markdown,
				updatedAt: now,
			})
			.where(eq(reviewDrafts.id, REVIEW_DRAFT_ID))
			.run();

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
		const now = new Date();

		// Count draft comments
		const comments = db
			.select()
			.from(draftComments)
			.where(eq(draftComments.reviewDraftId, REVIEW_DRAFT_ID))
			.all();

		// Check if summary was saved
		const draft = db.select().from(reviewDrafts).where(eq(reviewDrafts.id, REVIEW_DRAFT_ID)).get();

		// Update status to ready
		db.update(reviewDrafts)
			.set({ status: "ready", updatedAt: now })
			.where(eq(reviewDrafts.id, REVIEW_DRAFT_ID))
			.run();

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						status: "ready",
						draft_count: comments.length,
						summary_saved: !!draft?.summaryMarkdown,
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
			.select()
			.from(reviewDrafts)
			.where(eq(reviewDrafts.id, REVIEW_DRAFT_ID))
			.get();

		if (!currentDraft?.previousDraftId) {
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
			.select()
			.from(draftComments)
			.where(eq(draftComments.reviewDraftId, currentDraft.previousDraftId))
			.all();

		const result = previousComments.map((c) => ({
			id: c.id,
			filePath: c.filePath,
			lineNumber: c.lineNumber,
			side: c.side,
			body: c.body,
			status: c.status,
			platformCommentId: c.platformCommentId,
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
		const id = randomUUID();
		const now = new Date();

		const prevComment = db
			.select()
			.from(draftComments)
			.where(eq(draftComments.id, previous_comment_id))
			.get();

		if (!prevComment) {
			return {
				content: [{ type: "text", text: JSON.stringify({ error: "Previous comment not found" }) }],
			};
		}

		db.insert(draftComments)
			.values({
				id,
				reviewDraftId: REVIEW_DRAFT_ID,
				filePath: prevComment.filePath,
				lineNumber: prevComment.lineNumber,
				side: prevComment.side,
				body: `Resolved: ${reason}`,
				status: "pending",
				previousCommentId: previous_comment_id,
				resolution: "resolved-by-code",
				resolutionReason: reason,
				createdAt: now,
			})
			.run();

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
		const id = randomUUID();
		const now = new Date();

		const prevComment = db
			.select()
			.from(draftComments)
			.where(eq(draftComments.id, previous_comment_id))
			.get();

		if (!prevComment) {
			return {
				content: [{ type: "text", text: JSON.stringify({ error: "Previous comment not found" }) }],
			};
		}

		db.insert(draftComments)
			.values({
				id,
				reviewDraftId: REVIEW_DRAFT_ID,
				filePath: prevComment.filePath,
				lineNumber: prevComment.lineNumber,
				side: prevComment.side,
				body: `Flagged: ${reason}`,
				status: "pending",
				previousCommentId: previous_comment_id,
				resolution: "incorrectly-resolved",
				resolutionReason: reason,
				createdAt: now,
			})
			.run();

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({ id, resolution: "incorrectly-resolved" }),
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
