import { expect, test } from "bun:test";
import { RendererTrust } from "../src/main/terminal/renderer-trust";

test("new metadata operations require registered app document, live main frame and exact sender", () => {
	const trust = new RendererTrust();
	trust.register(7, "file:///app/renderer/index.html");
	expect(
		trust.authorize({
			id: 7,
			url: "file:///app/renderer/index.html#terminal",
			frameId: 1,
			mainFrameId: 1,
			destroyed: false,
		})
	).toEqual({ senderId: 7, frameId: 1 });
	for (const change of [
		{ id: 8 },
		{ url: "file:///tmp/drop.mov" },
		{ url: "https://example.com" },
		{ frameId: 2 },
		{ destroyed: true },
	]) {
		expect(() =>
			trust.authorize({
				id: 7,
				url: "file:///app/renderer/index.html",
				frameId: 1,
				mainFrameId: 1,
				destroyed: false,
				...change,
			})
		).toThrow();
	}
	expect(trust.navigationAllowed(7, "file:///tmp/file.txt")).toBe(false);
	trust.register(9, "http://localhost:5173/");
	expect(trust.navigationAllowed(9, "http://localhost:5173.evil/")).toBe(false);
	expect(trust.navigationAllowed(9, "http://localhost:5173/other")).toBe(false);
});
