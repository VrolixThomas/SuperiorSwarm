import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalFileController } from "../src/renderer/components/terminal-file-controller";
import type { TerminalFileBatch } from "../src/shared/terminal-files";
mock.module("../src/renderer/trpc/client", () => ({ trpcVanilla: { terminalFiles: {} } }));
const { TerminalFileShelf } = await import("../src/renderer/components/TerminalFileShelf");
const batch: TerminalFileBatch = {
	id: "batch",
	target: { terminalId: "t1", workspaceId: "ws", generation: "g1", root: "/generated" },
	entries: [
		{
			id: "entry",
			label: "a.mov",
			path: "/generated/a.mov",
			size: 10,
			kind: "file",
			referenceAllowed: true,
			copyAllowed: true,
			symlink: false,
			external: false,
		},
	],
};
function controller() {
	return new TerminalFileController(
		{
			prepare: async () => batch,
			resolve: async () => ({ text: " '/generated/a.mov' ", target: batch.target }),
			insert: async () => "admitted",
			cancel: async () => {},
			copy: async () => batch,
			ready: () => true,
			paste: (text) => text,
			focus: () => {},
		},
		() => {}
	);
}
test("shelf renders destination-labelled region, live status, keyboard controls and honest provider limits", () => {
	const html = renderToStaticMarkup(
		<TerminalFileShelf
			terminalId="t1"
			controller={controller()}
			state={{ batch, busy: false, status: "Nothing has been sent." }}
			onFiles={() => {}}
		/>
	);
	expect(html).toContain('aria-label="Files for terminal t1"');
	expect(html).toContain('<output aria-live="polite">');
	expect(html).toContain('aria-label="Remove a.mov"');
	expect(html).toContain('aria-label="Copy a.mov into workspace"');
	expect(html).toContain('type="file" multiple=""');
	expect(html).toContain("Insert paths (1)");
	expect(html).toContain("provider understanding and access are unverified");
	expect(html).toContain("unmatched quotes");
	expect(html).toContain("2 GiB/file, 4 GiB/workspace");
});
test("unsupported entries disable insertion; labels are escaped and bidi isolated", () => {
	const unsafe = {
		...batch,
		entries: [
			{
				...batch.entries[0]!,
				label: "<img src=x>",
				referenceAllowed: false,
				error: "Save locally",
			},
		],
	};
	const html = renderToStaticMarkup(
		<TerminalFileShelf
			terminalId="t1"
			controller={controller()}
			state={{ batch: unsafe, busy: false, status: "Save locally" }}
			onFiles={() => {}}
		/>
	);
	expect(html).toContain("<bdi>&lt;img src=x&gt;</bdi>");
	expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Insert paths/);
});
