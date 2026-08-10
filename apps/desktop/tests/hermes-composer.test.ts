import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HermesComposerAttachments } from "../src/renderer/components/hermes/HermesComposerAttachments";
import {
	type HermesComposerAttachment,
	hermesComposerTextareaLayout,
} from "../src/renderer/hermes/hermes-view-model";

const attachment = (
	overrides: Partial<HermesComposerAttachment> = {}
): HermesComposerAttachment => ({
	handle: "opaque-1",
	name: "release-notes-with-a-very-long-unbroken-name.txt",
	size: 1_536,
	mimeType: "text/plain",
	kind: "file",
	expiresAt: 10,
	status: "ready",
	error: null,
	...overrides,
});

describe("Hermes composer", () => {
	test("bounds auto-growing input between 56 and 180 pixels", () => {
		expect(hermesComposerTextareaLayout(20)).toEqual({ height: 56, overflowY: "hidden" });
		expect(hermesComposerTextareaLayout(120)).toEqual({ height: 120, overflowY: "hidden" });
		expect(hermesComposerTextareaLayout(240)).toEqual({ height: 180, overflowY: "auto" });
	});

	test("shows safe name, size, type, retry state, and an accessible removal control", () => {
		const html = renderToStaticMarkup(
			createElement(HermesComposerAttachments, {
				attachments: [
					attachment(),
					attachment({
						handle: "opaque-2",
						name: "screen.png",
						kind: "image",
						mimeType: "image/png",
						status: "attaching",
					}),
					attachment({
						handle: "opaque-3",
						name: "failed.pdf",
						kind: "pdf",
						mimeType: "application/pdf",
						status: "error",
						error: "Could not attach",
					}),
				],
				onRemove: () => undefined,
				removalDisabled: false,
			})
		);

		expect(html).toContain("release-notes-with-a-very-long-unbroken-name.txt");
		expect(html).toContain("1.5 KB");
		expect(html).toContain("Ready");
		expect(html).toContain("Attaching…");
		expect(html).toContain("Retry on send");
		expect(html).toContain('aria-label="Remove screen.png"');
		expect(html).not.toContain("Uploaded");
		expect(html).not.toContain("/Users/");
	});

	test("disables removal controls while file selection or submission owns the attachments", () => {
		const html = renderToStaticMarkup(
			createElement(HermesComposerAttachments, {
				attachments: [attachment({ status: "attaching" })],
				onRemove: () => undefined,
				removalDisabled: true,
			})
		);

		expect(html).toContain('aria-label="Remove release-notes-with-a-very-long-unbroken-name.txt"');
		expect(html).toContain('disabled=""');
	});
});
