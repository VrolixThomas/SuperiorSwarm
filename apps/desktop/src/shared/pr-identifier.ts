/** Parse a PR identifier like "owner/repo#123" into parts */
export function parsePrIdentifier(identifier: string): {
	owner: string;
	repo: string;
	number: number;
} | null {
	const match = identifier.match(/^(.+?)\/(.+?)#(\d+)$/);
	if (!match) return null;
	return {
		owner: match[1]!,
		repo: match[2]!,
		number: Number(match[3]),
	};
}

/** Format a PR identifier as "owner/repo#123" */
export function formatPrIdentifier(parts: { owner: string; repo: string; number: number }): string {
	return `${parts.owner}/${parts.repo}#${parts.number}`;
}
