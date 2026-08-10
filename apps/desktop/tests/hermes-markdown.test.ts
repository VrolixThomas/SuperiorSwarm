import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	HermesMarkdown,
	classifyHermesMarkdownLink,
	normalizeHermesCodeLanguage,
	prepareHermesCode,
} from "../src/renderer/components/hermes/HermesMarkdown";
import { HermesTranscript } from "../src/renderer/components/hermes/HermesTranscript";
import { projectHermesTranscript } from "../src/renderer/hermes/hermes-view-model";
import type { HermesTranscriptMessage } from "../src/shared/hermes";

const message = (overrides: Partial<HermesTranscriptMessage>): HermesTranscriptMessage => ({
	id: "message-1",
	canonicalMessageId: null,
	compactionGeneration: null,
	active: null,
	compacted: null,
	displayKind: null,
	compactionSummaryType: null,
	turnId: null,
	role: "assistant",
	text: "",
	createdAt: 1,
	status: "complete",
	toolName: null,
	workspaceArtifacts: [],
	...overrides,
});

describe("Hermes Markdown", () => {
	test("pretty-prints valid JSON with two spaces without rewriting value tokens", () => {
		const source = '{"large":9007199254740993,"exponent":1e+3,"nested":{"ok":true}}';

		expect(prepareHermesCode(source, "JSON")).toEqual({
			display: [
				"{",
				'  "large": 9007199254740993,',
				'  "exponent": 1e+3,',
				'  "nested": {',
				'    "ok": true',
				"  }",
				"}",
			].join("\n"),
			jsonStatus: "valid",
			label: "JSON",
			language: "json",
			source,
		});
	});

	test("bounds valid deeply nested JSON formatting with a verbatim fallback", () => {
		const depth = 2_000;
		const source = `${"[".repeat(depth)}0${"]".repeat(depth)}`;
		let prepared: ReturnType<typeof prepareHermesCode> | undefined;

		expect(() => {
			prepared = prepareHermesCode(source, "json");
		}).not.toThrow();
		expect(prepared?.jsonStatus).toBe("valid");
		expect(prepared?.source).toBe(source);
		expect(prepared?.display.length).toBeLessThanOrEqual(source.length * 2);
	});

	test("keeps the complete original JSON source separate from its pretty display for copying", async () => {
		const source = '{\n\t"answer" : 42,\n "items" : [1, 2]\n}\n';
		const prepared = prepareHermesCode(source, "json");
		const componentSource = await Bun.file(
			new URL("../src/renderer/components/hermes/HermesMarkdown.tsx", import.meta.url)
		).text();

		expect(prepared.source).toBe(source);
		expect(prepared.display).not.toBe(source);
		expect(componentSource).toContain("navigator.clipboard.writeText(presentation.source)");
	});

	test("keeps invalid JSON verbatim and marks it invalid", () => {
		const source = '{\n  "answer": 42,\n  trailing: true\n}\n';

		expect(prepareHermesCode(source, "json")).toEqual({
			display: source,
			jsonStatus: "invalid",
			label: "JSON",
			language: "json",
			source,
		});
		const html = renderToStaticMarkup(
			createElement(HermesMarkdown, { content: `\`\`\`json\n${source}\`\`\`` })
		);
		expect(html).toContain(">JSON<");
		expect(html).toContain("Invalid syntax");
		expect(html).toContain("trailing: true");
	});

	test("normalizes common language aliases and retains safe generic labels", () => {
		expect(normalizeHermesCodeLanguage(" language-TS ")).toBe("typescript");
		expect(normalizeHermesCodeLanguage("sh")).toBe("shell");
		expect(normalizeHermesCodeLanguage("text/plain")).toBe("text");
		expect(normalizeHermesCodeLanguage("Rust")).toBe("rust");
		expect(normalizeHermesCodeLanguage(undefined)).toBe("text");
	});

	test("allows only absolute HTTP(S) links for external navigation", () => {
		expect(classifyHermesMarkdownLink("https://example.com/docs?q=1")).toEqual({
			kind: "external",
			href: "https://example.com/docs?q=1",
		});
		expect(classifyHermesMarkdownLink("http://127.0.0.1:8080/status")).toEqual({
			kind: "external",
			href: "http://127.0.0.1:8080/status",
		});
		expect(classifyHermesMarkdownLink("HTTP://EXAMPLE.COM/Docs?q=1")).toEqual({
			kind: "external",
			href: "http://example.com/Docs?q=1",
		});
		for (const href of [
			"javascript:alert(1)",
			"data:text/html,unsafe",
			"file:///tmp/private",
			"//example.com/protocol-relative",
			"/relative/path",
			"#local-anchor",
		]) {
			expect(classifyHermesMarkdownLink(href)).toEqual({ kind: "blocked" });
		}
	});

	test("renders the supported semantic structure without rendering raw HTML", async () => {
		const content = [
			"## Heading",
			"",
			"Paragraph with **strong**, *emphasis*, ~~strike~~, and `inline code`.",
			"",
			"- unordered",
			"",
			"1. ordered",
			"",
			"> quoted",
			"",
			"---",
			"",
			"[Safe](https://example.com/docs) [Blocked](javascript:alert(1))",
			"",
			"| Key | Value |",
			"| --- | --- |",
			"| one | two |",
			"",
			"<script>alert('unsafe')</script><b>raw HTML</b>",
		].join("\n");
		const html = renderToStaticMarkup(createElement(HermesMarkdown, { content }));
		const componentSource = await Bun.file(
			new URL("../src/renderer/components/hermes/HermesMarkdown.tsx", import.meta.url)
		).text();

		expect(html).toContain("<h2");
		expect(html).toMatch(/<strong[^>]*>strong<\/strong>/);
		expect(html).toMatch(/<em[^>]*>emphasis<\/em>/);
		expect(html).toMatch(/<del[^>]*>strike<\/del>/);
		expect(html).toContain("<ul");
		expect(html).toContain("<ol");
		expect(html).toContain("<blockquote");
		expect(html).toContain("<hr");
		expect(html).toContain('href="https://example.com/docs"');
		expect(html).toContain('data-hermes-link="blocked"');
		expect(html).toContain("<table");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<b>");
		expect(html).not.toContain("javascript:");
		expect(componentSource).not.toContain("dangerouslySetInnerHTML");
		expect(componentSource).not.toContain("rehypeRaw");
		expect(componentSource).toContain('from "../MarkdownRenderer"');
		expect(componentSource).toContain("<MarkdownRenderer");
		expect(componentSource).not.toContain('from "react-markdown"');
	});

	test("contains inline code, fenced code, and tables inside dedicated width boundaries", () => {
		const longToken = "x".repeat(2_048);
		const content = [
			`Inline \`${longToken}\``,
			"",
			"```json",
			'{"ok":true}',
			"```",
			"",
			"| Long |",
			"| --- |",
			`| ${longToken} |`,
		].join("\n");
		const html = renderToStaticMarkup(createElement(HermesMarkdown, { content }));
		const root = html.match(/<div[^>]*data-hermes-markdown="true"[^>]*>/)?.[0];
		const codeViewport = html.match(/<div[^>]*data-hermes-code-viewport="true"[^>]*>/)?.[0];
		const tableViewport = html.match(/<div[^>]*data-hermes-table-viewport="true"[^>]*>/)?.[0];
		const pre = html.match(/<pre[^>]*>/)?.[0];

		expect(root).toContain("min-w-0");
		expect(root).toContain("overflow-x-hidden");
		expect(codeViewport).toContain("max-h-80");
		expect(codeViewport).toContain("overflow-x-auto");
		expect(tableViewport).toContain("max-w-full");
		expect(tableViewport).toContain("overflow-x-auto");
		expect(pre).not.toContain("overflow-x-auto");
		expect(html).toContain('data-hermes-inline-code="true"');
		expect(html).toContain("break-all");
		expect(html).toContain('aria-label="Copy JSON code"');
		expect(html).toContain(">JSON<");
		expect(html).toContain('data-hermes-json-token="key"');
	});

	test("uses the semantic renderer for both user and assistant message bodies", () => {
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "user-markdown", role: "user", text: "## User heading" }),
					message({ id: "assistant-markdown", text: "**Assistant strong**" }),
				]),
			})
		);
		const userStart = html.indexOf('data-hermes-turn="user"');
		const assistantStart = html.indexOf('data-hermes-turn="assistant"');
		const userMarkup = html.slice(userStart, assistantStart);
		const assistantMarkup = html.slice(assistantStart);

		expect(userMarkup).toContain('data-hermes-markdown="true"');
		expect(userMarkup).toContain("<h2");
		expect(userMarkup).not.toContain("## User heading");
		expect(assistantMarkup).toContain('data-hermes-markdown="true"');
		expect(assistantMarkup).toMatch(/<strong[^>]*>Assistant strong<\/strong>/);
		expect(assistantMarkup).not.toContain("**Assistant strong**");
	});
});
