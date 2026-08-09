import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
	return await Bun.file(new URL(`../src/renderer/${path}`, import.meta.url)).text();
}

describe("Hermes layout contract", () => {
	test("keeps the reading canvas bounded and the transcript vertically scrollable only", async () => {
		const view = await source("components/hermes/HermesSessionView.tsx");
		const viewModel = await source("hermes/hermes-view-model.ts");

		expect(view).toContain("HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner");
		expect(view).toContain("HERMES_CHAT_OVERFLOW_CLASSES.canvas");
		expect(view).toContain("h-14");
		expect(view).toContain('aria-label="Session options"');
		expect(view).toContain("Jump to latest");
		expect(view).toContain("hermesComposerTextareaLayout");
		expect(view).toContain('aria-label="Attach files"');
		expect(view).toContain("onDragOver");
		expect(view).toContain("onDrop");
		expect(view).toContain("onPaste");
		expect(view).toContain("Use the paperclip to attach files");
		expect(view).toContain('aria-label={live.running ? "Stop response" : "Send message"}');
		expect(view).not.toMatch(/transcriptOwner[^\n]*overflow-x-auto/);
		expect(viewModel).toContain('canvas: "mx-auto w-full min-w-0 max-w-[720px]"');
	});

	test("uses a 288 pixel default sidebar and progressive new-session/advanced controls", async () => {
		const app = await source("App.tsx");
		const sidebar = await source("components/hermes/HermesSidebar.tsx");

		expect(app).toContain('defaultSize="288px"');
		expect(app).toContain('minSize="232px"');
		expect(sidebar).toContain("New agent session");
		expect(sidebar).toContain("<details");
		expect(sidebar).toContain("min-h-[56px]");
		expect(sidebar).toContain('aria-label="Search agent sessions"');
	});
});
