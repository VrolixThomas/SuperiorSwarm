import { z } from "zod";
import type { TaskRegistration } from "../control-plane/task-registry";
import type { ReviewPathStorage } from "./storage";
import {
	answerInputSchema,
	contextStepSchema,
	findingInputSchema,
	pathContentSchema,
	stepSchema,
	threadNoteSchema,
} from "./validation";

const scope = { run_id: z.string().min(1), run_version: z.number().int().positive() };
export const reviewPathToolSchema = z.discriminatedUnion("tool", [
	z
		.object({ ...scope, tool: z.literal("add_review_finding"), ...findingInputSchema.shape })
		.strict(),
	z
		.object({ ...scope, tool: z.literal("set_review_summary"), summary: z.string().max(64000) })
		.strict(),
	z.object({ ...scope, tool: z.literal("get_review_path") }).strict(),
	z.object({ ...scope, tool: z.literal("set_review_path"), ...pathContentSchema.shape }).strict(),
	z
		.object({
			...scope,
			tool: z.literal("add_path_step"),
			entry_id: z.string().min(1),
			entry_title: z.string().min(1),
			step: stepSchema,
		})
		.strict(),
	z
		.object({
			...scope,
			tool: z.literal("add_context_step"),
			entry_id: z.string().min(1),
			entry_title: z.string().min(1),
			step: contextStepSchema,
		})
		.strict(),
	z
		.object({
			...scope,
			tool: z.literal("set_thread_note"),
			thread_id: z.string().min(1),
			note: threadNoteSchema,
		})
		.strict(),
	z
		.object({
			...scope,
			tool: z.literal("answer_question"),
			question_id: z.string().min(1),
			...answerInputSchema.shape,
		})
		.strict(),
	z.object({ ...scope, tool: z.literal("finish_review_path") }).strict(),
	z
		.object({ ...scope, tool: z.literal("fail_review_path"), error: z.string().min(1).max(4096) })
		.strict(),
]);
/** Called only after consuming a launch token from the app's task registry. */
export function authorizeReviewPathTask(store: ReviewPathStorage, task: TaskRegistration): string {
	const run = store.getRun(task.modeContext["reviewPathRunId"] ?? "");
	if (
		task.mode !== "review-path" ||
		!run ||
		run.identity.workspaceId !== task.workspaceId ||
		String(run.version) !== task.modeContext["reviewPathRunVersion"]
	)
		throw new Error("Invalid reading path task scope");
	return store.grantCapability(run);
}
export function executeReviewPathTool(
	store: ReviewPathStorage,
	capability: string,
	input: unknown
) {
	const data = reviewPathToolSchema.parse(input);
	const run = store.authenticateCapability(capability);
	if (run.id !== data.run_id || run.version !== data.run_version)
		throw new Error("Wrong run scope");
	switch (data.tool) {
		case "add_review_finding": {
			const { tool: _, run_id: __, run_version: ___, ...finding } = data;
			store.addFinding(run, finding);
			break;
		}
		case "set_review_summary":
			store.setReviewSummary(run, data.summary);
			break;
		case "get_review_path":
			return store.peek(run.identity);
		case "set_review_path":
			store.setPath(run, {
				entries: data.entries,
				otherFiles: data.otherFiles,
				reviewed: data.reviewed,
			});
			break;
		case "add_path_step":
		case "add_context_step":
			store.addStep(run, data.entry_id, data.entry_title, data.step);
			break;
		case "set_thread_note":
			store.setThreadNote(run, data.thread_id, data.note);
			break;
		case "answer_question":
			store.answerQuestion(run, data.question_id, { text: data.text, refs: data.refs });
			break;
		case "finish_review_path":
			store.finish(run);
			break;
		case "fail_review_path":
			store.fail(run, data.error);
			break;
	}
	return store.peek(run.identity);
}
