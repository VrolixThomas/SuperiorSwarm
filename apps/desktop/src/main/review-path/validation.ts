import { z } from "zod";
import type { ReviewPathEntry } from "../../shared/review-path-types";

export const repoPathSchema = z
	.string()
	.min(1)
	.max(4096)
	.refine(
		(path) =>
			!path.startsWith("/") &&
			!path.includes("\\") &&
			!path.includes(":") &&
			[...path].every((c) => c.charCodeAt(0) >= 32) &&
			path.split("/").every((p) => p !== ".." && p !== "." && p !== ""),
		"Expected a safe repository-relative path"
	);
const id = z.string().min(1).max(256);
export const focusSchema = z
	.object({
		side: z.enum(["LEFT", "RIGHT"]),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.strict()
	.refine((r) => r.endLine >= r.startLine, "Range is reversed");
export const anchorSchema = z
	.object({ path: repoPathSchema, ...focusSchema.shape })
	.strict()
	.refine((r) => r.endLine >= r.startLine, "Range is reversed");
export const referenceSchema = z
	.object({
		path: repoPathSchema,
		line: z.number().int().positive(),
		description: z.string().max(4096),
	})
	.strict();
const base = {
	id,
	path: repoPathSchema,
	note: z.string().max(4096),
	detail: z.string().max(32000).optional(),
	focus: z.array(focusSchema).max(1000),
	alsoIn: z.array(id).max(1000).optional(),
};
export const contextStepSchema = z
	.object({
		...base,
		kind: z.literal("context"),
		addedBy: z.enum(["agent", "user"]),
		usedBy: z.array(referenceSchema).max(1000).optional(),
	})
	.strict();
export const changedStepSchema = z
	.object({
		...base,
		kind: z.literal("changed"),
		tests: z.array(z.object({ path: repoPathSchema, changed: z.boolean() }).strict()).max(10000),
	})
	.strict();
export const stepSchema = z.discriminatedUnion("kind", [changedStepSchema, contextStepSchema]);
export const pathContentSchema = z
	.object({
		entries: z
			.array(
				z
					.object({ id, title: z.string().min(1).max(4096), steps: z.array(stepSchema).max(10000) })
					.strict()
			)
			.max(1000),
		otherFiles: z.array(repoPathSchema).max(10000),
		reviewed: z.object({ findings: z.number().int().nonnegative() }).strict().optional(),
	})
	.strict();
export const threadNoteSchema = z
	.object({
		verdict: z.enum(["addressed", "open", "unclear"]),
		text: z.string().max(32000),
		refs: z.array(referenceSchema).max(1000).optional(),
	})
	.strict();
export const questionInputSchema = z
	.object({ id, text: z.string().min(1).max(64000), anchor: anchorSchema.optional() })
	.strict();
export const answerInputSchema = z
	.object({
		text: z.string().min(1).max(64000),
		refs: z.array(referenceSchema).max(1000).optional(),
	})
	.strict();

/** Validate authoritative coverage, including test placement, before storing any update. */
export function validateCoverage(
	entries: ReviewPathEntry[],
	otherFiles: string[],
	changedFiles: string[]
) {
	const changed = new Set(changedFiles);
	const covered = new Set<string>();
	const displayed = new Set<string>();
	const ids = new Set<string>();
	const entryIds = new Set<string>();
	const unique = (set: Set<string>, value: string) => {
		if (set.has(value)) throw new Error(`Duplicate coverage or ID: ${value}`);
		set.add(value);
	};
	const file = (path: string, isChanged: boolean) => {
		unique(displayed, path);
		if (changed.has(path) !== isChanged) throw new Error(`Changed-file mismatch: ${path}`);
		if (isChanged) unique(covered, path);
	};
	for (const entry of entries) unique(entryIds, entry.id);
	for (const entry of entries)
		for (const step of entry.steps) {
			unique(ids, step.id);
			file(step.path, step.kind === "changed");
			if (step.alsoIn?.some((id) => !entryIds.has(id))) throw new Error("Unknown entry reference");
			if (step.kind === "changed") for (const test of step.tests) file(test.path, test.changed);
		}
	for (const path of otherFiles) file(path, true);
	if (covered.size !== changed.size) throw new Error("Missing changed-file coverage");
}

export const findingInputSchema = z
	.object({
		file_path: repoPathSchema,
		line_number: z.number().int().positive().optional(),
		side: z.enum(["LEFT", "RIGHT"]).optional(),
		body: z.string().min(1).max(64000),
		category: z.string().min(1).max(128).optional(),
	})
	.strict();
