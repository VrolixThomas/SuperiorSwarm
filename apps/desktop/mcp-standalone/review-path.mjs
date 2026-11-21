import { z } from "zod";
import { controlPlaneToolResult } from "./structured-artifact.mjs";

/** All identity is supplied by the consumed task token, never by an MCP argument. */
export function registerReviewPathTools(server, { context, discovery, fetchImpl = fetch }) {
	if (context.mode !== "review-path" || !context.modeContext?.reviewPathCapability) return;
	const scope = { run_id: z.string().min(1), run_version: z.number().int().positive() };
	const definitions = [
		[
			"add_review_finding",
			"Save a local draft finding for this exact run, only when Also review is enabled. Never posts to provider.",
			{
				file_path: z.string(),
				line_number: z.number().int().positive().optional(),
				side: z.enum(["LEFT", "RIGHT"]).optional(),
				body: z.string(),
				category: z.string().optional(),
			},
		],
		[
			"set_review_summary",
			"Save the local draft summary. Never submits a review.",
			{ summary: z.string() },
		],
		["get_review_path", "Read this run's persisted path, question and conversation.", {}],
		[
			"set_review_path",
			"Replace the reading path for this exact head. Every changed file must occur exactly once in steps, changed tests or otherFiles.",
			{
				entries: z.array(z.unknown()),
				otherFiles: z.array(z.string()),
				reviewed: z.object({ findings: z.number().int().nonnegative() }).optional(),
			},
		],
		[
			"add_path_step",
			"Append a changed-file step; removes its coverage from Other files.",
			{ entry_id: z.string(), entry_title: z.string(), step: z.unknown() },
		],
		[
			"add_context_step",
			"Append an unchanged context step with addedBy agent.",
			{ entry_id: z.string(), entry_title: z.string(), step: z.unknown() },
		],
		[
			"set_thread_note",
			"Save a local thread hint. Does not post to the provider.",
			{ thread_id: z.string(), note: z.unknown() },
		],
		[
			"answer_question",
			"Answer the exact pending question and finish its run. Does not post comments.",
			{ question_id: z.string(), text: z.string(), refs: z.array(z.unknown()).optional() },
		],
		["finish_review_path", "Finish mapping; all subsequent writes from this run are rejected.", {}],
		[
			"fail_review_path",
			"Record mapping/question failure and end this run.",
			{ error: z.string() },
		],
	];
	for (const [name, description, fields] of definitions) {
		server.tool(name, description, { ...scope, ...fields }, async (args) => {
			try {
				const response = await fetchImpl(`http://127.0.0.1:${discovery.port}/review-path.tool`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${discovery.token}`,
						"Content-Type": "application/json",
						"X-Review-Path-Capability": context.modeContext.reviewPathCapability,
					},
					body: JSON.stringify({ ...args, tool: name }),
					signal: AbortSignal.timeout(15000),
				});
				const body = await response.json();
				if (!response.ok)
					return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
				return controlPlaneToolResult(body);
			} catch {
				return {
					isError: true,
					content: [{ type: "text", text: "Reading path control plane unavailable" }],
				};
			}
		});
	}
}
