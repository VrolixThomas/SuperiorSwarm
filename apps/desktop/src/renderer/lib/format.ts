export function initials(name: string): string {
	const tokens = name.split(/[\s\-_]+/).filter(Boolean);
	if (tokens.length === 0) return "";
	if (tokens.length === 1) return tokens[0]!.slice(0, 2).toUpperCase();
	return tokens
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? "")
		.join("");
}
