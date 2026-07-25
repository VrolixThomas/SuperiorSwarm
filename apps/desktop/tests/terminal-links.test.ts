import { describe, expect, mock, test } from "bun:test";
import { createTerminalLinkHandler } from "../src/renderer/components/terminal-links";

describe("createTerminalLinkHandler", () => {
	test("routes terminal links through the external browser API", () => {
		const openExternal = mock(async (_url: string) => {});
		const handler = createTerminalLinkHandler(openExternal);

		handler({} as MouseEvent, "https://example.com/codex");

		expect(openExternal).toHaveBeenCalledTimes(1);
		expect(openExternal).toHaveBeenCalledWith("https://example.com/codex");
	});
});
