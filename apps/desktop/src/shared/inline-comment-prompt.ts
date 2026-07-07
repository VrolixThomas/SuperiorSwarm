export interface PromptComment {
	filePath: string;
	startLine: number;
	endLine: number;
	codeSnapshot: string;
	body: string;
	outdated?: boolean;
}

const OUTDATED_NOTE =
	"Note: the commented code was not found at this location anymore; the comment may refer to an earlier version.";

export function buildInlineCommentsPrompt(comments: PromptComment[]): string {
	const sorted = [...comments].sort(
		(a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine
	);

	const sections = sorted.map((c) => {
		const range = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
		const quoted = c.codeSnapshot
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		const lines = [`## ${c.filePath}:${range}`];
		if (c.outdated) lines.push(OUTDATED_NOTE);
		lines.push(quoted, `Comment: ${c.body}`);
		return lines.join("\n");
	});

	return ["Address the following review comments on your current changes:", "", ...sections].join(
		"\n\n"
	);
}
