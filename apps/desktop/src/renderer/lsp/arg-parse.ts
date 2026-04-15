import { parse, quote } from "shell-quote";

export function parseArgs(input: string): string[] {
	const trimmed = input.trim();
	if (!trimmed) return [];
	const tokens = parse(trimmed);
	const args: string[] = [];
	for (const token of tokens) {
		if (typeof token === "string") {
			args.push(token);
		}
		// shell-quote returns objects for operators (|, ;, >) or comments — skip them.
		// LSP args should not contain shell operators anyway.
	}
	return args;
}

export function stringifyArgs(args: string[]): string {
	return quote(args);
}
