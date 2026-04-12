import { parsePrIdentifier as parseNullable } from "../../shared/pr-identifier";

/** Parse a PR identifier like "owner/repo#123" into parts. Throws on invalid input. */
export function parsePrIdentifier(identifier: string): {
	owner: string;
	repo: string;
	number: number;
} {
	const result = parseNullable(identifier);
	if (!result) throw new Error(`Invalid PR identifier: ${identifier}`);
	return result;
}
