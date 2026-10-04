import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalFileShelf } from "../src/renderer/components/TerminalFileShelf";
import { TerminalFileController } from "../src/renderer/components/terminal-file-controller";
import type { TerminalFileBatch } from "../src/shared/terminal-files";
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
			append: async () => batch,
			resolve: async () => ({ text: " '/generated/a.mov' ", target: batch.target }),
			insert: async () => "admitted",
			cancel: async () => {},
			copy: async () => batch,
			copyPaths: async () => " '/generated/a.mov' ",
			clipboard: async () => {},
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
	expect(html).toMatch(/<output[^>]*aria-live="polite"/);
	expect(html).toContain('aria-label="Remove a.mov"');
	expect(html).toContain('aria-label="Details for a.mov"');
	expect(html).toContain('type="file" multiple=""');
	expect(html).toContain("1 file added");
	expect(html).not.toContain("Saved copies");
	expect(html).not.toContain("Copy into workspace");
	expect(html).toContain("Enter to insert paths");
	expect(html).not.toContain("Enter to send");
	expect(html).not.toContain("Insert paths");
	expect(html).not.toContain("/generated/a.mov</bdi>");
	expect(html).not.toContain("2 GiB/file, 4 GiB/workspace");
});
test("unsupported entries need attention; labels are escaped and bidi isolated", () => {
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
	expect(html).toContain("Needs attention");
	expect(html).not.toContain("Insert paths");
});

test("a blocked native-agent batch shows the update requirement instead of promising Enter will send", () => {
	const html = renderToStaticMarkup(
		<TerminalFileShelf
			terminalId="t1"
			controller={controller()}
			state={{
				batch: { ...batch, inputAvailability: "update-required" },
				busy: false,
				status: "Update needed",
			}}
			onFiles={() => {}}
		/>
	);
	expect(html).toContain("Terminal update required");
	expect(html).not.toContain("Enter to send");
	expect(html).toContain("Copy paths");
	expect(html).toContain('aria-label="Remove a.mov"');
});
