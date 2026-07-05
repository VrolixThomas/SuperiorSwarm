import type { DiffHunk, DiffLine } from "../../../../shared/diff-types";
import type { PRContext } from "../../../../shared/github-types";
import { extractDiffContext } from "../../../lib/pr-review-threads";
import { trpc } from "../../../trpc/client";

interface DiffContextSnippetProps {
	prCtx: PRContext;
	path: string;
	line: number;
	side?: "LEFT" | "RIGHT";
}

function lineNumberLabel(lineNumber: number | undefined): string {
	return lineNumber == null ? "" : String(lineNumber);
}

function signForLine(diffLine: DiffLine): string {
	if (diffLine.type === "added") return "+";
	if (diffLine.type === "removed") return "-";
	return "";
}

function lineNumberForSide(diffLine: DiffLine, side: "LEFT" | "RIGHT"): number | undefined {
	return side === "LEFT" ? diffLine.oldLineNumber : diffLine.newLineNumber;
}

function contextLinesForSide(hunks: DiffHunk[], line: number, side: "LEFT" | "RIGHT"): DiffLine[] {
	if (side === "RIGHT") return extractDiffContext(hunks, line, 2);

	for (const hunk of hunks) {
		const index = hunk.lines.findIndex((diffLine) => diffLine.oldLineNumber === line);
		if (index === -1) continue;

		const start = Math.max(0, index - 2);
		const end = Math.min(hunk.lines.length, index + 3);
		return hunk.lines.slice(start, end);
	}

	return [];
}

function rowBackgroundClassName(
	diffLine: DiffLine,
	targetLine: number,
	side: "LEFT" | "RIGHT"
): string {
	if (lineNumberForSide(diffLine, side) === targetLine) return "bg-[var(--accent-subtle)]";
	if (diffLine.type === "added") return "bg-[var(--success-subtle)]";
	if (diffLine.type === "removed") return "bg-[var(--danger-subtle)]";
	return "";
}

function signClassName(diffLine: DiffLine): string {
	if (diffLine.type === "added") return "text-[var(--color-success)]";
	if (diffLine.type === "removed") return "text-[var(--color-danger)]";
	return "text-[var(--text-quaternary)]";
}

function diffLineKey(diffLine: DiffLine, index: number): string {
	const oldLine = diffLine.oldLineNumber ?? "none";
	const newLine = diffLine.newLineNumber ?? "none";
	return `${diffLine.type}:${oldLine}:${newLine}:${index}:${diffLine.content}`;
}

export function DiffContextSnippet({ prCtx, path, line, side = "RIGHT" }: DiffContextSnippetProps) {
	const { data } = trpc.diff.getBranchDiff.useQuery(
		{ repoPath: prCtx.repoPath, baseBranch: prCtx.targetBranch, headBranch: prCtx.sourceBranch },
		{ staleTime: 60_000 }
	);
	const hunks = data?.files.find((file) => file.path === path)?.hunks;

	if (!hunks) return null;

	const lines = contextLinesForSide(hunks, line, side);

	if (lines.length === 0) return null;

	return (
		<div className="overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-base)] font-mono text-[12px] leading-[1.6]">
			{lines.map((diffLine, index) => (
				<div
					key={diffLineKey(diffLine, index)}
					className={`flex min-w-max ${rowBackgroundClassName(diffLine, line, side)}`}
				>
					<span className="w-10 shrink-0 select-none pr-2 text-right tabular-nums text-[var(--text-quaternary)]">
						{lineNumberLabel(diffLine.oldLineNumber)}
					</span>
					<span className="w-10 shrink-0 select-none pr-2 text-right tabular-nums text-[var(--text-quaternary)]">
						{lineNumberLabel(diffLine.newLineNumber)}
					</span>
					<span className={`w-4 shrink-0 select-none text-center ${signClassName(diffLine)}`}>
						{signForLine(diffLine)}
					</span>
					<span className="whitespace-pre pr-4 text-[var(--text-secondary)]">
						{diffLine.content}
					</span>
				</div>
			))}
		</div>
	);
}
