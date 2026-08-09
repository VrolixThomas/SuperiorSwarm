import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HermesTranscript } from "../src/renderer/components/hermes/HermesTranscript";
import {
	HERMES_LONG_USER_MESSAGE_CHAR_THRESHOLD,
	HERMES_LONG_USER_MESSAGE_LINE_THRESHOLD,
	hermesUserMessageDisclosure,
	projectHermesTranscript,
} from "../src/renderer/hermes/hermes-view-model";
import type { HermesTranscriptMessage } from "../src/shared/hermes";

const message = (overrides: Partial<HermesTranscriptMessage>): HermesTranscriptMessage => ({
	id: "message-1",
	turnId: null,
	role: "assistant",
	text: "",
	createdAt: 1,
	status: "complete",
	toolName: null,
	workspaceArtifacts: [],
	...overrides,
});

describe("Hermes transcript", () => {
	test("left-aligns assistant prose and right-aligns neutral user bubbles within the frame", () => {
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "user-1", role: "user", text: "A compact request" }),
					message({ id: "assistant-1", text: "A calm, readable response" }),
				]),
			})
		);

		expect(html).toContain('data-hermes-turn="user"');
		expect(html).toContain('data-hermes-turn="assistant"');
		expect(html).toContain('data-hermes-align="frame-start"');
		expect(html).toContain("max-w-[66ch]");
		expect(html).toContain("ml-auto");
		expect(html).toContain("max-w-[min(640px,76%)]");
		expect(html).toContain("A compact request");
		expect(html).toContain("A calm, readable response");
		const userBubble = html.match(/<div[^>]*data-hermes-user-bubble="true"[^>]*>/)?.[0];
		expect(userBubble).toContain("bg-[var(--bg-elevated)]");
		expect(userBubble).toContain("border-[var(--border-subtle)]");
		expect(userBubble).toContain("ml-auto");
		expect(userBubble).not.toContain("mr-auto");
		expect(userBubble).not.toContain("--accent");
		expect(html).not.toContain(">USER<");
		expect(html).not.toContain(">ASSISTANT<");
	});

	test("collapses exceptionally long user text by generic length or line thresholds", () => {
		const exactCharacterLimit = "x".repeat(HERMES_LONG_USER_MESSAGE_CHAR_THRESHOLD);
		const overCharacterLimit = `${exactCharacterLimit}x`;
		const exactLineLimit = Array.from(
			{ length: HERMES_LONG_USER_MESSAGE_LINE_THRESHOLD },
			(_, index) => `line ${index + 1}`
		).join("\n");
		const overLineLimit = `${exactLineLimit}\none more line`;

		expect(hermesUserMessageDisclosure(exactCharacterLimit, false).collapsible).toBe(false);
		expect(hermesUserMessageDisclosure(overCharacterLimit, false)).toEqual({
			collapsible: true,
			collapsed: true,
			ariaExpanded: false,
			label: "Show full message",
		});
		expect(hermesUserMessageDisclosure(exactLineLimit, false).collapsible).toBe(false);
		expect(hermesUserMessageDisclosure(overLineLimit, true)).toEqual({
			collapsible: true,
			collapsed: false,
			ariaExpanded: true,
			label: "Collapse message",
		});
	});

	test("renders long canonical user text in an accessible collapsed preview", () => {
		const canonicalText = `Canonical payload\n${"payload ".repeat(300)}`;
		const wrapped = [
			"[SuperiorSwarm attachments]",
			'{"kind":"file","name":"canonical.txt","ref":"@file:attachments/canonical.txt"}',
			"[/SuperiorSwarm attachments]",
			"",
			canonicalText,
		].join("\n");
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "user-disclosure", role: "user", text: wrapped }),
				]),
			})
		);

		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain('aria-controls="hermes-user-message-user:user-disclosure"');
		expect(html).toContain('id="hermes-user-message-user:user-disclosure"');
		expect(html).toContain("Show full message");
		expect(html).toContain("max-h-[240px]");
		expect(html).toContain("bg-gradient-to-t");
		const collapsedContent = html.match(
			/<div[^>]*id="hermes-user-message-user:user-disclosure"[^>]*>/
		)?.[0];
		const showFullMessageControl = html.match(/<button[^>]*>Show full message<\/button>/)?.[0];
		expect(collapsedContent).toContain('inert=""');
		expect(showFullMessageControl).toBeDefined();
		expect(showFullMessageControl).not.toContain("inert");
		expect(showFullMessageControl).not.toContain("disabled");
		expect(html).toContain(canonicalText.trimEnd());
		expect(html).toContain("canonical.txt");
		expect(html).toContain("@file:attachments/canonical.txt");
		expect(html).not.toContain("SuperiorSwarm attachments");
	});

	test("leaves short user messages unchanged without disclosure controls", () => {
		const canonicalText = "A short canonical message";
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "user-short", role: "user", text: canonicalText }),
				]),
			})
		);

		expect(html).toContain(canonicalText);
		expect(html).not.toContain("Show full message");
		expect(html).not.toContain("aria-expanded");
		expect(html).not.toContain("max-h-[240px]");
	});

	test("preserves canonical quoted prose exactly", () => {
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "assistant-quoted", text: '"Keep these quotes"' }),
				]),
			})
		);

		expect(html).toContain("&quot;Keep these quotes&quot;");
	});

	test("renders submitted attachments as compact chips without raw context markers", () => {
		const wrapped = [
			"[SuperiorSwarm attachments]",
			'{"kind":"pdf","name":"release.pdf"}',
			'{"kind":"file","name":"notes.txt","ref":"@file:attachments/notes.txt"}',
			"[/SuperiorSwarm attachments]",
			"",
			"Summarize the release",
		].join("\n");
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "user-files", role: "user", text: wrapped }),
				]),
			})
		);

		expect(html).toContain("release.pdf");
		expect(html).toContain("notes.txt");
		expect(html).toContain("@file:attachments/notes.txt");
		expect(html).toContain("Summarize the release");
		expect(html).not.toContain("SuperiorSwarm attachments");
	});

	test("contains pathological prose horizontally while preserving the bounded reading rail", () => {
		const pathological = `https://example.invalid/${"x".repeat(4_096)}`;
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "user-long", role: "user", text: pathological }),
					message({ id: "assistant-long", text: pathological }),
				]),
			})
		);

		expect(html).toContain("min-w-0 break-words [overflow-wrap:anywhere]");
		expect(html).not.toContain("overflow-x-auto");
	});

	test("renders escaped raw activity in nested native disclosures", () => {
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({
						id: "tool-1",
						role: "tool",
						toolName: "terminal",
						text: "<script>unsafe()</script>",
					}),
				]),
			})
		);

		expect(html.match(/<details/g)).toHaveLength(2);
		expect(html).toContain("Ran 1 action");
		expect(html).toContain('data-hermes-align="frame-start"');
		expect(html).toContain("w-full");
		expect(html).toContain("max-w-[66ch]");
		expect(html).toContain("Raw details");
		expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
		expect(html).not.toContain("<script>");
		expect(html).not.toMatch(/<details[^>]* open/);
	});

	test("opens failed activity by default and never emits an empty conversation card", () => {
		const html = renderToStaticMarkup(
			createElement(HermesTranscript, {
				items: projectHermesTranscript([
					message({ id: "blank", text: " " }),
					message({ id: "failed", text: "provider failed", status: "error" }),
				]),
			})
		);

		expect(html).toMatch(/<details[^>]* open/);
		expect(html).toContain("actions failed");
		expect(html).not.toContain("data-hermes-turn");
	});
});
