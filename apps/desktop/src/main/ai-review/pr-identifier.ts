/** Parse a PR identifier like "owner/repo#123" into parts */
export function parsePrIdentifier(identifier: string): {
	owner: string;
	repo: string;
	number: number;
} {
	const match = identifier.match(/^(.+?)\/(.+?)#(\d+)$/);
	if (!match) throw new Error(`Invalid PR identifier: ${identifier}`);
	return {
		owner: match[1]!,
		repo: match[2]!,
		number: Number.parseInt(match[3]!, 10),
	};
}
