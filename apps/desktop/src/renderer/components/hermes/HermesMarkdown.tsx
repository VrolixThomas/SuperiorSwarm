import { Children, type ReactNode, isValidElement, memo, useEffect, useRef, useState } from "react";
import { type MarkdownComponents, MarkdownRenderer } from "../MarkdownRenderer";

interface HermesMarkdownProps {
	content: string;
	className?: string;
}

export type HermesMarkdownLinkClassification =
	| { kind: "external"; href: string }
	| { kind: "blocked" };

export interface HermesPreparedCode {
	code: string;
	jsonStatus: "valid" | "invalid" | null;
	label: string;
	language: string;
}

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
	bash: "shell",
	"application/json": "json",
	"application/ld+json": "json",
	js: "javascript",
	md: "markdown",
	plaintext: "text",
	py: "python",
	sh: "shell",
	"text/plain": "text",
	txt: "text",
	ts: "typescript",
	yml: "yaml",
	zsh: "shell",
};

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
	javascript: "JavaScript",
	json: "JSON",
	jsx: "JSX",
	markdown: "Markdown",
	python: "Python",
	shell: "Shell",
	text: "Plain text",
	tsx: "TSX",
	typescript: "TypeScript",
	yaml: "YAML",
};

export function normalizeHermesCodeLanguage(language: string | null | undefined): string {
	const normalized = (language ?? "")
		.trim()
		.toLowerCase()
		.replace(/^language-/, "")
		.replace(/[^a-z0-9+#._/-]/g, "");
	if (!normalized) return "text";
	return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function hermesCodeLanguageLabel(language: string): string {
	return LANGUAGE_LABELS[language] ?? `${language.charAt(0).toUpperCase()}${language.slice(1)}`;
}

function adjacentSignificantCharacter(
	source: string,
	start: number,
	direction: -1 | 1
): string | null {
	for (let index = start + direction; index >= 0 && index < source.length; index += direction) {
		const character = source[index];
		if (character !== undefined && !/\s/.test(character)) return character;
	}
	return null;
}

function formatValidJson(source: string): string {
	let result = "";
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === undefined) continue;
		if (inString) {
			result += character;
			if (escaped) {
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === '"') {
			inString = true;
			result += character;
			continue;
		}
		if (/\s/.test(character)) continue;

		switch (character) {
			case "{":
			case "[": {
				result += character;
				depth += 1;
				const closingCharacter = character === "{" ? "}" : "]";
				if (adjacentSignificantCharacter(source, index, 1) !== closingCharacter) {
					result += `\n${"  ".repeat(depth)}`;
				}
				break;
			}
			case "}":
			case "]": {
				depth = Math.max(0, depth - 1);
				const openingCharacter = character === "}" ? "{" : "[";
				if (adjacentSignificantCharacter(source, index, -1) !== openingCharacter) {
					result += `\n${"  ".repeat(depth)}`;
				}
				result += character;
				break;
			}
			case ",":
				result += `,\n${"  ".repeat(depth)}`;
				break;
			case ":":
				result += ": ";
				break;
			default:
				result += character;
		}
	}

	return result;
}

export function prepareHermesCode(
	code: string,
	language: string | null | undefined
): HermesPreparedCode {
	const normalizedLanguage = normalizeHermesCodeLanguage(language);
	const label = hermesCodeLanguageLabel(normalizedLanguage);
	if (normalizedLanguage !== "json") {
		return { code, jsonStatus: null, label, language: normalizedLanguage };
	}

	try {
		JSON.parse(code);
		return {
			code: formatValidJson(code),
			jsonStatus: "valid",
			label,
			language: normalizedLanguage,
		};
	} catch {
		return { code, jsonStatus: "invalid", label, language: normalizedLanguage };
	}
}

export function classifyHermesMarkdownLink(
	href: string | null | undefined
): HermesMarkdownLinkClassification {
	if (!href) return { kind: "blocked" };
	try {
		const parsed = new URL(href);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return { kind: "blocked" };
		}
		return { kind: "external", href };
	} catch {
		return { kind: "blocked" };
	}
}

interface HermesCodeBlockProps {
	code: string;
	language?: string | null;
}

interface JsonToken {
	kind: "boolean" | "key" | "null" | "number" | "string";
	start: number;
	text: string;
}

const JSON_TOKEN_PATTERN =
	/("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?|\b(?:true|false|null)\b/g;

function jsonTokens(code: string): JsonToken[] {
	return Array.from(code.matchAll(JSON_TOKEN_PATTERN), (match) => {
		const text = match[0];
		let kind: JsonToken["kind"];
		if (match[1]) kind = "key";
		else if (match[2]) kind = "string";
		else if (text === "null") kind = "null";
		else if (text === "true" || text === "false") kind = "boolean";
		else kind = "number";
		return { kind, start: match.index, text };
	});
}

const JSON_TOKEN_CLASSES: Readonly<Record<JsonToken["kind"], string>> = {
	boolean: "text-[#fbbf24]",
	key: "text-[#7dd3fc]",
	null: "text-[#fbbf24]",
	number: "text-[#d8b4fe]",
	string: "text-[#a7f3d0]",
};

function HermesJsonCode({ code }: { code: string }) {
	const tokens = jsonTokens(code);
	let cursor = 0;
	const children: ReactNode[] = [];
	for (const [index, token] of tokens.entries()) {
		if (token.start > cursor) children.push(code.slice(cursor, token.start));
		children.push(
			<span
				key={`${token.start}:${index}`}
				className={JSON_TOKEN_CLASSES[token.kind]}
				data-hermes-json-token={token.kind}
			>
				{token.text}
			</span>
		);
		cursor = token.start + token.text.length;
	}
	if (cursor < code.length) children.push(code.slice(cursor));
	return children;
}

export function HermesCodeBlock({ code, language }: HermesCodeBlockProps) {
	const presentation = prepareHermesCode(code, language);
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
		},
		[]
	);

	async function copyCode(): Promise<void> {
		try {
			await navigator.clipboard.writeText(presentation.code);
			setCopied(true);
			if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
			copiedTimer.current = setTimeout(() => setCopied(false), 1_500);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div
			className="my-4 min-w-0 max-w-full overflow-hidden rounded-[10px] border border-white/10 bg-[#101318] text-[#d6dae3] shadow-[0_8px_24px_rgba(0,0,0,0.18)] first:mt-0 last:mb-0"
			data-hermes-code-block="true"
			data-language={presentation.language}
		>
			<div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/8 bg-[#161a21] px-3 py-1.5 text-[10px] leading-4 text-[#8e97a8] select-none">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate font-medium tracking-[0.04em]">{presentation.label}</span>
					{presentation.jsonStatus === "invalid" && (
						<span className="shrink-0 rounded-full border border-[#fbbf24]/25 bg-[#fbbf24]/10 px-1.5 text-[#fcd34d]">
							Invalid syntax
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={() => void copyCode()}
					aria-label={
						copied ? `${presentation.label} code copied` : `Copy ${presentation.label} code`
					}
					className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[#aeb6c5] outline-none transition-colors hover:bg-white/8 hover:text-white focus-visible:ring-2 focus-visible:ring-[#7dd3fc]/60 motion-reduce:transition-none"
				>
					<span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
				</button>
			</div>
			<div
				className="max-h-80 min-w-0 max-w-full overflow-x-auto overflow-y-auto overscroll-contain"
				data-hermes-code-viewport="true"
			>
				<pre className="w-max min-w-full p-3 font-[var(--font-mono)] text-[12px] leading-5 whitespace-pre selection:bg-[#0a84ff]/35 selection:text-white">
					<code>
						{presentation.jsonStatus === "valid" ? (
							<HermesJsonCode code={presentation.code} />
						) : (
							presentation.code
						)}
					</code>
				</pre>
			</div>
		</div>
	);
}

function reactNodeText(children: ReactNode): string {
	return Children.toArray(children)
		.map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
		.join("");
}

const HERMES_MARKDOWN_COMPONENTS: MarkdownComponents = {
	a: ({ children, href, title }) => {
		const link = classifyHermesMarkdownLink(href);
		if (link.kind === "blocked") {
			return (
				<span
					className="break-all text-[var(--text-tertiary)] underline decoration-dotted underline-offset-2"
					data-hermes-link="blocked"
					title="Blocked unsafe link"
				>
					{children}
				</span>
			);
		}
		return (
			<a
				href={link.href}
				title={title}
				rel="noreferrer noopener"
				className="break-all text-[var(--accent)] underline decoration-[var(--accent)]/45 underline-offset-2 hover:decoration-[var(--accent)] focus-visible:rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
				onClick={(event) => {
					event.preventDefault();
					void window.electron.shell.openExternal(link.href);
				}}
			>
				{children}
			</a>
		);
	},
	blockquote: ({ children }) => (
		<blockquote className="my-4 min-w-0 border-l-2 border-[var(--border-active)] pl-3 text-[var(--text-tertiary)] italic first:mt-0 last:mb-0">
			{children}
		</blockquote>
	),
	code: ({ children, className }) => (
		<code
			className={`rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-overlay)]/70 px-1.5 py-0.5 font-[var(--font-mono)] text-[0.88em] text-[var(--text)] whitespace-pre-wrap break-all [overflow-wrap:anywhere] ${className ?? ""}`}
			data-hermes-inline-code="true"
		>
			{children}
		</code>
	),
	del: ({ children }) => <del className="text-[var(--text-tertiary)]">{children}</del>,
	em: ({ children }) => <em className="text-[var(--text-secondary)]">{children}</em>,
	h1: ({ children }) => (
		<h1 className="mb-2 mt-6 text-[1.45em] font-semibold leading-tight tracking-[-0.02em] text-[var(--text)] first:mt-0 last:mb-0">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="mb-2 mt-5 text-[1.25em] font-semibold leading-tight tracking-[-0.015em] text-[var(--text)] first:mt-0 last:mb-0">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="mb-1.5 mt-4 text-[1.1em] font-semibold leading-snug text-[var(--text)] first:mt-0 last:mb-0">
			{children}
		</h3>
	),
	h4: ({ children }) => (
		<h4 className="mb-1.5 mt-4 font-semibold text-[var(--text)] first:mt-0 last:mb-0">
			{children}
		</h4>
	),
	h5: ({ children }) => (
		<h5 className="mb-1 mt-3 text-[0.95em] font-semibold text-[var(--text)] first:mt-0 last:mb-0">
			{children}
		</h5>
	),
	h6: ({ children }) => (
		<h6 className="mb-1 mt-3 text-[0.9em] font-semibold uppercase tracking-[0.04em] text-[var(--text-tertiary)] first:mt-0 last:mb-0">
			{children}
		</h6>
	),
	hr: () => <hr className="my-5 border-0 border-t border-[var(--border-subtle)]" />,
	img: ({ alt }) => (
		<span className="text-[var(--text-tertiary)]" data-hermes-image="blocked">
			{alt ? `[Image: ${alt}]` : "[Image]"}
		</span>
	),
	li: ({ children }) => <li className="min-w-0 pl-0.5 [overflow-wrap:anywhere]">{children}</li>,
	ol: ({ children, start }) => (
		<ol
			start={start}
			className="my-3 min-w-0 list-decimal space-y-1 pl-5 marker:text-[var(--text-tertiary)] first:mt-0 last:mb-0"
		>
			{children}
		</ol>
	),
	p: ({ children }) => (
		<p className="my-3 min-w-0 leading-[inherit] [overflow-wrap:anywhere] first:mt-0 last:mb-0">
			{children}
		</p>
	),
	pre: ({ children }) => {
		const codeElement = Children.count(children) === 1 ? Children.only(children) : null;
		if (!isValidElement<{ children?: ReactNode; className?: string }>(codeElement)) {
			return <HermesCodeBlock code={reactNodeText(children)} />;
		}
		const languageClass = codeElement.props.className
			?.split(/\s+/)
			.find((value) => value.startsWith("language-"));
		return (
			<HermesCodeBlock code={reactNodeText(codeElement.props.children)} language={languageClass} />
		);
	},
	strong: ({ children }) => (
		<strong className="font-semibold text-[var(--text)]">{children}</strong>
	),
	table: ({ children }) => (
		<div
			className="my-4 min-w-0 max-w-full overflow-x-auto rounded-[8px] border border-[var(--border-subtle)] first:mt-0 last:mb-0"
			data-hermes-table-viewport="true"
		>
			<table className="w-max min-w-full border-collapse text-left text-[0.9em]">{children}</table>
		</div>
	),
	td: ({ children, style }) => (
		<td
			style={style}
			className="max-w-[32rem] border-t border-[var(--border-subtle)] px-3 py-2 align-top [overflow-wrap:anywhere]"
		>
			{children}
		</td>
	),
	th: ({ children, style }) => (
		<th
			style={style}
			className="max-w-[32rem] bg-[var(--bg-surface)] px-3 py-2 font-semibold text-[var(--text)] [overflow-wrap:anywhere]"
		>
			{children}
		</th>
	),
	ul: ({ children }) => (
		<ul className="my-3 min-w-0 list-disc space-y-1 pl-5 marker:text-[var(--text-tertiary)] first:mt-0 last:mb-0">
			{children}
		</ul>
	),
};

export const HermesMarkdown = memo(function HermesMarkdown({
	content,
	className,
}: HermesMarkdownProps) {
	return (
		<div
			className={`min-w-0 max-w-full overflow-x-hidden [overflow-wrap:anywhere] ${className ?? ""}`}
			data-hermes-markdown="true"
		>
			<MarkdownRenderer
				content={content}
				components={HERMES_MARKDOWN_COMPONENTS}
				skipHtml
				syntaxHighlighting={false}
				variant="unstyled"
			/>
		</div>
	);
});
