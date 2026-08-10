import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { HermesSessionSummary } from "../src/shared/hermes";

const testWindow = new Window({ url: "http://localhost" });
const browserGlobals: Record<string, unknown> = {
	window: testWindow,
	self: testWindow,
	document: testWindow.document,
	navigator: testWindow.navigator,
	Node: testWindow.Node,
	Element: testWindow.Element,
	HTMLElement: testWindow.HTMLElement,
	HTMLButtonElement: testWindow.HTMLButtonElement,
	HTMLDialogElement: testWindow.HTMLDialogElement,
	Event: testWindow.Event,
	MouseEvent: testWindow.MouseEvent,
	KeyboardEvent: testWindow.KeyboardEvent,
	MutationObserver: testWindow.MutationObserver,
	getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
	requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
	cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
	IS_REACT_ACT_ENVIRONMENT: true,
};

for (const [key, value] of Object.entries(browserGlobals)) {
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { createRoot } = await import("react-dom/client");
const { OverflowPopover } = await import("../src/renderer/components/hermes/OverflowPopover");
const { HermesSessionRow } = await import("../src/renderer/components/hermes/HermesSessionRow");

interface RectInit {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface PopoverHarness {
	trigger: HTMLButtonElement;
	setTriggerRect: (rect: RectInit) => void;
}

let mountedRoot: Root | null = null;
let activeLabel = "";
let activeTriggerRect: RectInit = { left: 0, top: 0, width: 0, height: 0 };
let activePanelRect: RectInit = { left: 0, top: 0, width: 360, height: 220 };

function asDomRect({ left, top, width, height }: RectInit): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	};
}

function click(element: Element): void {
	element.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
}

function Harness({ label, onAction }: { label: string; onAction: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<div data-testid="overflow-ancestor" style={{ overflow: "hidden" }}>
			<OverflowPopover label={label} open={open} onOpenChange={setOpen}>
				<button type="button">Keep open</button>
				<button type="button" data-popover-close onClick={onAction}>
					Run action
				</button>
			</OverflowPopover>
			<button type="button">Outside control</button>
		</div>
	);
}

const sessionRowFixture: HermesSessionSummary = {
	id: "session-important",
	title: "Important session",
	preview: "Review the release",
	profileId: "work",
	source: "superiorswarm",
	updatedAt: Date.now(),
	createdAt: Date.now(),
	archived: false,
	running: false,
	busy: false,
	waitingForUser: false,
	messageCount: 2,
	isCron: false,
	handover: false,
	admissionReason: null,
	origin: null,
};

async function mountPopover({
	label,
	triggerRect,
	panelRect,
	onAction = () => undefined,
}: {
	label: string;
	triggerRect: RectInit;
	panelRect: RectInit;
	onAction?: () => void;
}): Promise<PopoverHarness> {
	activeLabel = label;
	activeTriggerRect = triggerRect;
	activePanelRect = panelRect;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mountedRoot = root;
	await act(async () => root.render(<Harness label={label} onAction={onAction} />));
	const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
	if (!trigger) throw new Error(`Missing ${label} trigger`);
	return {
		trigger,
		setTriggerRect: (rect) => {
			activeTriggerRect = rect;
		},
	};
}

async function openPopover(trigger: HTMLButtonElement): Promise<HTMLDialogElement> {
	await act(async () => click(trigger));
	const panel = document.querySelector<HTMLDialogElement>("dialog");
	if (!panel) throw new Error("Popover did not open");
	return panel;
}

async function source(path: string): Promise<string> {
	return await Bun.file(new URL(`../src/renderer/${path}`, import.meta.url)).text();
}

beforeEach(() => {
	testWindow.innerWidth = 1_000;
	testWindow.innerHeight = 800;
	document.body.replaceChildren();
	testWindow.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
		if (
			this instanceof testWindow.HTMLButtonElement &&
			this.getAttribute("aria-label") === activeLabel
		) {
			return asDomRect(activeTriggerRect);
		}
		if (this instanceof testWindow.HTMLDialogElement) {
			const styledWidth = Number.parseFloat(this.style.width);
			const styledMaxHeight = Number.parseFloat(this.style.maxHeight);
			return asDomRect({
				...activePanelRect,
				width: Number.isNaN(styledWidth)
					? activePanelRect.width
					: Math.min(activePanelRect.width, styledWidth),
				height: Number.isNaN(styledMaxHeight)
					? activePanelRect.height
					: Math.min(activePanelRect.height, styledMaxHeight),
			});
		}
		return asDomRect({ left: 0, top: 0, width: 0, height: 0 });
	};
});

afterEach(async () => {
	if (mountedRoot) await act(async () => mountedRoot?.unmount());
	mountedRoot = null;
	document.body.replaceChildren();
});

describe("Agents overflow popovers", () => {
	test("session row actions are discoverable, keyboard controls that never select the row", async () => {
		const onSelect = mock(() => undefined);
		const onSetArchived = mock((_archived: boolean) => undefined);
		const onDelete = mock(() => undefined);
		let confirmationCount = 0;
		const confirmDelete = mock((message: string) => {
			expect(message).toContain("Important session");
			confirmationCount++;
			return confirmationCount > 1;
		});
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		mountedRoot = root;
		await act(async () =>
			root.render(
				<HermesSessionRow
					session={sessionRowFixture}
					selected={false}
					linkedBranch="feat/release"
					actionPending={false}
					onSelect={onSelect}
					onSetArchived={onSetArchived}
					onDelete={onDelete}
					confirmDelete={confirmDelete}
				/>
			)
		);

		const trigger = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Actions for Important session"]'
		);
		if (!trigger) throw new Error("Missing session actions trigger");
		const triggerOwner = trigger.closest<HTMLElement>("[data-session-actions-trigger]");
		expect(triggerOwner?.className).toContain("opacity-0");
		expect(triggerOwner?.className).toContain("group-hover:opacity-100");
		expect(triggerOwner?.className).toContain("group-focus-within:opacity-100");

		await act(async () => click(trigger));
		expect(onSelect).not.toHaveBeenCalled();
		let panel = document.querySelector<HTMLDialogElement>("dialog");
		if (!panel) throw new Error("Missing session actions menu");
		const archive = Array.from(panel.querySelectorAll("button")).find(
			(button) => button.textContent === "Archive"
		);
		if (!archive) throw new Error("Missing Archive action");
		await act(async () => click(archive));
		expect(onSetArchived).toHaveBeenCalledWith(true);
		expect(onSelect).not.toHaveBeenCalled();

		await act(async () => click(trigger));
		panel = document.querySelector<HTMLDialogElement>("dialog");
		const firstDelete = Array.from(panel?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent === "Delete permanently…"
		);
		if (!firstDelete) throw new Error("Missing permanent deletion action");
		await act(async () => click(firstDelete));
		expect(confirmDelete).toHaveBeenCalledTimes(1);
		expect(onDelete).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();

		await act(async () => click(trigger));
		panel = document.querySelector<HTMLDialogElement>("dialog");
		const confirmedDelete = Array.from(panel?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent === "Delete permanently…"
		);
		if (!confirmedDelete) throw new Error("Missing retry deletion action");
		await act(async () => click(confirmedDelete));
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(onSelect).not.toHaveBeenCalled();

		const openRow = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Important session"]'
		);
		if (!openRow) throw new Error("Missing row selection control");
		await act(async () => click(openRow));
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	test("selected and archived session rows expose the trigger and explicit Unarchive action", async () => {
		const html = renderToStaticMarkup(
			<HermesSessionRow
				session={{ ...sessionRowFixture, archived: true }}
				selected
				linkedBranch={null}
				actionPending={false}
				onSelect={() => undefined}
				onSetArchived={() => undefined}
				onDelete={() => undefined}
			/>
		);

		expect(html).toContain("opacity-100");
		expect(html).toContain('aria-label="Actions for Important session"');
		expect(html).not.toContain("Delete session Important session");

		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		mountedRoot = root;
		await act(async () =>
			root.render(
				<HermesSessionRow
					session={{ ...sessionRowFixture, archived: true }}
					selected
					linkedBranch={null}
					actionPending={false}
					onSelect={() => undefined}
					onSetArchived={() => undefined}
					onDelete={() => undefined}
				/>
			)
		);
		const trigger = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Actions for Important session"]'
		);
		if (!trigger) throw new Error("Missing selected session trigger");
		await act(async () => click(trigger));
		expect(document.querySelector("dialog")?.textContent).toContain("Unarchive");
	});

	test("shared controlled trigger exposes state, an accessible tooltip, and a centered icon", () => {
		const closed = renderToStaticMarkup(
			<OverflowPopover label="Connection options" open={false} onOpenChange={() => undefined}>
				<div>Actions</div>
			</OverflowPopover>
		);

		expect(closed).toContain('aria-haspopup="dialog"');
		expect(closed).toContain('aria-expanded="false"');
		expect(closed).toContain('aria-label="Connection options"');
		expect(closed).toContain('title="Connection options"');
		expect(closed.match(/<circle/g)).toHaveLength(3);
		expect(closed).toContain("size-7");
		expect(closed).not.toContain("•••");
	});

	const triggerCases = [
		{
			location: "connection/sidebar",
			label: "Manage agent connections",
			viewportWidth: 1_000,
			triggerRect: { left: 970, top: 740, width: 28, height: 28 },
			expectedRightEdgeLeft: 632,
		},
		{
			location: "selected session",
			label: "Actions for selected agent session",
			viewportWidth: 1_200,
			triggerRect: { left: 1_164, top: 740, width: 28, height: 28 },
			expectedRightEdgeLeft: 832,
		},
	] as const;

	for (const triggerCase of triggerCases) {
		describe(`${triggerCase.location} trigger`, () => {
			test("portals above clipped surfaces, clamps at the right edge, flips, and repositions", async () => {
				testWindow.innerWidth = triggerCase.viewportWidth;
				const harness = await mountPopover({
					label: triggerCase.label,
					triggerRect: triggerCase.triggerRect,
					panelRect: { left: 0, top: 0, width: 360, height: 220 },
				});
				const panel = await openPopover(harness.trigger);

				expect(panel.parentElement === document.body).toBe(true);
				expect(panel.style.position).toBe("fixed");
				expect(panel.style.left).toBe(`${triggerCase.expectedRightEdgeLeft}px`);
				expect(panel.style.top).toBe("512px");
				expect(panel.className).toContain("z-[100]");

				harness.setTriggerRect({ left: 80, top: 100, width: 28, height: 28 });
				await act(async () => testWindow.dispatchEvent(new testWindow.Event("scroll")));
				expect(panel.style.left).toBe("8px");
				expect(panel.style.top).toBe("136px");

				harness.setTriggerRect({ left: 500, top: 200, width: 28, height: 28 });
				await act(async () => testWindow.dispatchEvent(new testWindow.Event("resize")));
				expect(panel.style.left).toBe("168px");
				expect(panel.style.top).toBe("236px");
			});

			test("fits and locally scrolls the panel in a narrow, short viewport", async () => {
				const viewportWidth = triggerCase.location === "connection/sidebar" ? 256 : 280;
				testWindow.innerWidth = viewportWidth;
				testWindow.innerHeight = 180;
				const harness = await mountPopover({
					label: triggerCase.label,
					triggerRect: { left: viewportWidth - 36, top: 76, width: 28, height: 28 },
					panelRect: { left: 0, top: 0, width: 360, height: 300 },
				});
				const panel = await openPopover(harness.trigger);

				expect(panel.style.left).toBe("8px");
				expect(panel.style.top).toBe("8px");
				expect(panel.style.width).toBe(`${viewportWidth - 16}px`);
				expect(panel.style.maxHeight).toBe("164px");
				expect(panel.style.overflowY).toBe("auto");
			});

			test("keeps trigger and portal interactions inside, then dismisses outside, on Escape, and on action", async () => {
				const onAction = mock(() => undefined);
				const harness = await mountPopover({
					label: triggerCase.label,
					triggerRect: { left: 500, top: 200, width: 28, height: 28 },
					panelRect: { left: 0, top: 0, width: 360, height: 220 },
					onAction,
				});
				let panel = await openPopover(harness.trigger);
				const keepOpen = Array.from(panel.querySelectorAll("button")).find(
					(button) => button.textContent === "Keep open"
				);
				if (!keepOpen) throw new Error("Missing inside control");

				await act(async () => {
					harness.trigger.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true }));
					keepOpen.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true }));
					click(keepOpen);
				});
				expect(document.querySelector("dialog")).toBe(panel);

				const outside = Array.from(document.querySelectorAll("button")).find(
					(button) => button.textContent === "Outside control"
				);
				if (!outside) throw new Error("Missing outside control");
				outside.focus();
				await act(async () =>
					outside.dispatchEvent(new testWindow.MouseEvent("mousedown", { bubbles: true }))
				);
				expect(document.querySelector("dialog")).toBeNull();
				expect(document.activeElement).toBe(outside);

				panel = await openPopover(harness.trigger);
				await act(async () =>
					document.dispatchEvent(new testWindow.KeyboardEvent("keydown", { key: "Escape" }))
				);
				expect(document.querySelector("dialog")).toBeNull();
				expect(document.activeElement).toBe(harness.trigger);

				panel = await openPopover(harness.trigger);
				const action = Array.from(panel.querySelectorAll("button")).find(
					(button) => button.textContent === "Run action"
				);
				if (!action) throw new Error("Missing dismissing action");
				action.focus();
				await act(async () => click(action));
				expect(onAction).toHaveBeenCalledTimes(1);
				expect(document.querySelector("dialog")).toBeNull();
				expect(document.activeElement).toBe(harness.trigger);
			});
		});
	}

	test("both callers provide explicit labels and leave placement to the shared fixed layer", async () => {
		const shared = await source("components/hermes/OverflowPopover.tsx");
		const session = await source("components/hermes/HermesSessionView.tsx");
		const sidebar = await source("components/hermes/HermesSidebar.tsx");

		expect(shared).toContain("createPortal");
		expect(shared).toContain("getBoundingClientRect");
		expect(session).toContain('label="Actions for selected agent session"');
		expect(session).toContain("const hasSessionOptions =");
		expect(session).toContain("{hasSessionOptions && (");
		expect(sidebar).toContain('label="Manage agent connections"');
		expect(sidebar).toContain("<HermesSessionRow");
		expect(session).not.toContain('panelClassName="absolute');
		expect(sidebar).not.toContain('panelClassName="absolute');
	});
});
