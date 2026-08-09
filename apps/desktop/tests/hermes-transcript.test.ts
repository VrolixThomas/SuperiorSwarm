import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HermesTranscript } from "../src/renderer/components/hermes/HermesTranscript";
import { projectHermesTranscript } from "../src/renderer/hermes/hermes-view-model";
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
	test("renders user bubbles, unboxed assistant prose, and no role labels", () => {
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
		expect(html).toContain("max-w-[66ch]");
		expect(html).toContain("A compact request");
		expect(html).toContain("A calm, readable response");
		expect(html).not.toContain(">USER<");
		expect(html).not.toContain(">ASSISTANT<");
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
