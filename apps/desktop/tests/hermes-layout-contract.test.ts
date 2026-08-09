import { describe, expect, test } from "bun:test";
import { HERMES_CHAT_LAYOUT_CLASSES } from "../src/renderer/hermes/hermes-view-model";

async function source(path: string): Promise<string> {
	return await Bun.file(new URL(`../src/renderer/${path}`, import.meta.url)).text();
}

describe("Hermes layout contract", () => {
	test("uses the full pane width for the transcript frame and keeps overflow vertical", async () => {
		const view = await source("components/hermes/HermesSessionView.tsx");

		expect(view).toContain("HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner");
		expect(view.match(/HERMES_CHAT_LAYOUT_CLASSES\.gutter/g)).toHaveLength(2);
		expect(view.match(/HERMES_CHAT_LAYOUT_CLASSES\.frame/g)).toHaveLength(1);
		expect(view).toContain("HERMES_CHAT_LAYOUT_CLASSES.composerColumn");
		expect(view).toContain('data-hermes-alignment-frame="transcript"');
		expect(view).toContain('data-hermes-alignment-frame="composer"');
		expect(view).toContain("h-14");
		expect(view).toContain('label="Session options"');
		expect(view).toContain("state.hermesSessionPane");
		expect(view).toContain("state.setHermesSessionPane");
		expect(view).toContain('hidden={activePane !== "chat"}');
		expect(view).toContain("Jump to latest");
		expect(view).toContain("hermesComposerTextareaLayout");
		expect(view).toContain('aria-label="Attach files"');
		expect(view).toContain("onDragOver");
		expect(view).toContain("onDrop");
		expect(view).toContain("onPaste");
		expect(view).toContain("Use the paperclip to attach files");
		expect(view).toContain('aria-label={live.running ? "Stop response" : "Send message"}');
		expect(view).toContain("<HermesMarkdown content={live.streamingText} />");
		expect(view).toContain("const physicalMessages = useMemo");
		expect(view).toContain("deriveHermesCanonicalTimeline(physicalMessages)");
		expect(view).not.toMatch(/transcriptOwner[^\n]*overflow-x-auto/);

		expect(HERMES_CHAT_LAYOUT_CLASSES.gutter).toContain("px-4");
		expect(HERMES_CHAT_LAYOUT_CLASSES.gutter).toContain("md:px-6");
		expect(HERMES_CHAT_LAYOUT_CLASSES.gutter).toContain("lg:px-12");
		expect(HERMES_CHAT_LAYOUT_CLASSES.gutter).toContain("2xl:px-16");
		expect(HERMES_CHAT_LAYOUT_CLASSES.frame).toBe("w-full min-w-0 max-w-none");
		expect(HERMES_CHAT_LAYOUT_CLASSES.frame).not.toContain("max-w-[840px]");
		expect(HERMES_CHAT_LAYOUT_CLASSES.frame).not.toContain("max-w-[1120px]");
		expect(HERMES_CHAT_LAYOUT_CLASSES.frame).not.toContain("mx-auto");
		expect(HERMES_CHAT_LAYOUT_CLASSES.assistantColumn).toContain("max-w-[66ch]");
		expect(HERMES_CHAT_LAYOUT_CLASSES.assistantColumn).toContain("mr-auto");
		expect(HERMES_CHAT_LAYOUT_CLASSES.assistantColumn).not.toContain("ml-auto");
		expect(HERMES_CHAT_LAYOUT_CLASSES.activityColumn).toContain("w-full");
		expect(HERMES_CHAT_LAYOUT_CLASSES.activityColumn).toContain("max-w-[66ch]");
		expect(HERMES_CHAT_LAYOUT_CLASSES.activityColumn).toContain("mr-auto");
		expect(HERMES_CHAT_LAYOUT_CLASSES.activityColumn).not.toContain("ml-auto");
	});

	test("right-aligns user messages independently from the assistant rail", () => {
		expect(HERMES_CHAT_LAYOUT_CLASSES.userBubble).toContain("ml-auto");
		expect(HERMES_CHAT_LAYOUT_CLASSES.userBubble).toContain("max-w-[min(640px,76%)]");
		expect(HERMES_CHAT_LAYOUT_CLASSES.userBubble).not.toContain("mr-auto");
		expect(HERMES_CHAT_LAYOUT_CLASSES.userBubble).not.toContain("ml-6");
		expect(HERMES_CHAT_LAYOUT_CLASSES.userBubble).not.toContain("ml-8");
	});

	test("centers the composer independently in the full pane gutter", async () => {
		const view = await source("components/hermes/HermesSessionView.tsx");
		const composerOpeningTag = view.match(
			/<div\s+className=\{HERMES_CHAT_LAYOUT_CLASSES\.composerColumn\}\s+data-hermes-alignment-frame="composer"\s*>/
		)?.[0];

		expect(HERMES_CHAT_LAYOUT_CLASSES.composerColumn).toContain("max-w-[800px]");
		expect(HERMES_CHAT_LAYOUT_CLASSES.composerColumn).toContain("mx-auto");
		expect(HERMES_CHAT_LAYOUT_CLASSES.composerColumn).toContain("w-full");
		expect(HERMES_CHAT_LAYOUT_CLASSES.composerColumn).not.toContain("mr-auto");
		expect(composerOpeningTag).toBeDefined();
		expect(composerOpeningTag).not.toContain('data-hermes-align="frame-start"');
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
		expect(sidebar).not.toContain("No workspace");
		expect(sidebar).not.toContain("Optional linked ticket");
	});
});
