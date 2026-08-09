import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OverflowPopover } from "../src/renderer/components/hermes/OverflowPopover";

async function source(path: string): Promise<string> {
	return await Bun.file(new URL(`../src/renderer/${path}`, import.meta.url)).text();
}

describe("Agents overflow popovers", () => {
	test("shared controlled popover exposes state and a centered equal-circle icon", () => {
		const closed = renderToStaticMarkup(
			<OverflowPopover label="Options" open={false} onOpenChange={() => undefined}>
				<div>Actions</div>
			</OverflowPopover>
		);
		const open = renderToStaticMarkup(
			<OverflowPopover label="Options" open={true} onOpenChange={() => undefined}>
				<div>Actions</div>
			</OverflowPopover>
		);

		expect(closed).toContain('aria-haspopup="dialog"');
		expect(closed).toContain('aria-expanded="false"');
		expect(open).toContain('aria-expanded="true"');
		expect(open).toContain("<dialog");
		expect(open.match(/<circle/g)).toHaveLength(3);
		expect(open).toContain("size-7");
		expect(open).not.toContain("•••");
	});

	test("both locations use controlled outside-click and Escape dismissal", async () => {
		const shared = await source("components/hermes/OverflowPopover.tsx");
		const session = await source("components/hermes/HermesSessionView.tsx");
		const sidebar = await source("components/hermes/HermesSidebar.tsx");

		expect(shared).toContain("useClickOutside(rootRef, close, open)");
		expect(shared).toContain("useEscapeKey(closeAndRestoreFocus, open)");
		expect(shared).toContain("rootRef.current.contains");
		expect(session).toContain("<OverflowPopover");
		expect(session).toContain("open={sessionOptionsOpen}");
		expect(sidebar).toContain("<OverflowPopover");
		expect(sidebar).toContain("open={showAdvanced}");
		expect(session).not.toContain('<details className="app-no-drag');
		expect(sidebar).not.toContain("•••");
	});

	test("inside interaction stays open unless the action opts into closing", async () => {
		const shared = await source("components/hermes/OverflowPopover.tsx");
		const session = await source("components/hermes/HermesSessionView.tsx");
		const sidebar = await source("components/hermes/HermesSidebar.tsx");

		expect(shared).not.toMatch(/onClick=\{close\}[^>]*role="dialog"/);
		expect(shared).toContain('closest("[data-popover-close]")');
		expect(session).toContain("data-popover-close");
		expect(sidebar).toContain("data-popover-close");
	});
});
