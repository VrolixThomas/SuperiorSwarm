/** Parse a PR identifier like "owner/repo#123" into parts */
export function parsePrIdentifier(identifier: string): {
	owner: string;
	repo: string;
	number: number;
} {
	const match = identifier.match(/^(.+?)\/(.+?)#(\d+)$/);
	if (!match) throw new Error(`Invalid PR identifier: ${identifier}`);
	const [, owner, repo, num] = match;
	return {
		owner: owner ?? "",
		repo: repo ?? "",
		number: Number.parseInt(num ?? "", 10),
	};
}
