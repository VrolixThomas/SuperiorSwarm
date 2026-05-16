// Minimal TypeScript tokenizer for static syntax highlighting in the trailer.
// Returns spans with VS Code Dark+ colors. Not a real parser — handles the
// constructs used in the demo file/diff snippets.

const KEYWORDS = new Set([
	"import",
	"export",
	"from",
	"const",
	"let",
	"var",
	"function",
	"return",
	"type",
	"if",
	"else",
	"null",
	"true",
	"false",
	"new",
	"async",
	"await",
	"interface",
	"class",
	"this",
	"void",
	"as",
]);

const TYPES = new Set([
	"string",
	"number",
	"boolean",
	"void",
	"any",
	"TerminalStream",
	"ReactNode",
	"ReactElement",
]);

export interface SyntaxToken {
	text: string;
	color: string;
	italic?: boolean;
}

export function tokenizeTs(line: string, fallbackColor = "#d4d4d4"): SyntaxToken[] {
	if (line.trim().startsWith("//")) {
		return [{ text: line, color: "#6a9955", italic: true }];
	}
	const tokens: SyntaxToken[] = [];
	const re =
		/(\s+)|("[^"]*"|'[^']*'|`[^`]*`)|(\/\/.*$)|(\b\d+\b)|(\b[A-Za-z_$][A-Za-z0-9_$]*\b)|([{}()[\];,.<>:=+\-*/&|!?])/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: classic regex loop
	while ((match = re.exec(line)) !== null) {
		if (match.index > lastIndex) {
			tokens.push({ text: line.slice(lastIndex, match.index), color: fallbackColor });
		}
		const [whole, ws, str, comment, num, ident, punct] = match;
		if (ws !== undefined) {
			tokens.push({ text: ws, color: fallbackColor });
		} else if (str !== undefined) {
			tokens.push({ text: str, color: "#ce9178" });
		} else if (comment !== undefined) {
			tokens.push({ text: comment, color: "#6a9955", italic: true });
		} else if (num !== undefined) {
			tokens.push({ text: num, color: "#b5cea8" });
		} else if (ident !== undefined) {
			let color = "#9cdcfe"; // variable/identifier
			if (KEYWORDS.has(ident)) color = "#c586c0";
			else if (TYPES.has(ident)) color = "#4ec9b0";
			else if (/^use[A-Z]/.test(ident) || ident === "openAgentStream") color = "#dcdcaa";
			else if (ident === ident.toUpperCase() && ident.length > 1) color = "#4fc1ff";
			tokens.push({ text: ident, color });
		} else if (punct !== undefined) {
			tokens.push({ text: punct, color: fallbackColor });
		} else {
			tokens.push({ text: whole, color: fallbackColor });
		}
		lastIndex = re.lastIndex;
	}
	if (lastIndex < line.length) {
		tokens.push({ text: line.slice(lastIndex), color: fallbackColor });
	}
	return tokens;
}
