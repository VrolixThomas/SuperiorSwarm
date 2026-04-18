import type { z } from "zod";

export interface LspConfigFieldError {
	serverIndex: number;
	field: string;
	message: string;
}

export function zodIssuesToString(issues: z.ZodIssue[]): string {
	return issues
		.map((issue) => {
			const path = issue.path.map(String).join(".");
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join("; ");
}

// Paths like `[0, "command"]` → `{serverIndex: 0, field: "command"}`.
export function formatServerListIssues(issues: z.ZodIssue[]): LspConfigFieldError[] {
	const out: LspConfigFieldError[] = [];
	for (const issue of issues) {
		const [first, second, ...rest] = issue.path;
		if (typeof first !== "number") continue;
		const field = [second, ...rest].filter(Boolean).map(String).join(".");
		out.push({ serverIndex: first, field, message: issue.message });
	}
	return out;
}
