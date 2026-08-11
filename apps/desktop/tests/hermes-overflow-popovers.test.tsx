import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	HermesSessionSummary,
	HermesTagColor,
	HermesTagDefinition,
} from "../src/shared/hermes";

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
	setPanelRect: (rect: RectInit) => void;
	setTriggerRect: (rect: RectInit) => void;
}

class TestResizeObserver {
	readonly observed = new Set<Element>();
	disconnected = false;

	constructor(private readonly callback: ResizeObserverCallback) {
		resizeObserverInstances.push(this);
	}

	observe(target: Element): void {
		this.observed.add(target);
	}

	unobserve(target: Element): void {
		this.observed.delete(target);
	}

	disconnect(): void {
		this.disconnected = true;
		this.observed.clear();
	}

	notify(target: Element): void {
		this.callback(
			[{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
			this as unknown as ResizeObserver
		);
	}
}

let mountedRoot: Root | null = null;
let activeLabel = "";
let activeTriggerRect: RectInit = { left: 0, top: 0, width: 0, height: 0 };
let activePanelRect: RectInit = { left: 0, top: 0, width: 360, height: 220 };
let resizeObserverInstances: TestResizeObserver[] = [];

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
				<button type="button" disabled>
					Unavailable
				</button>
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
	generatedTitle: "Generated important session",
	titleSource: "custom",
	tags: [
		tagDefinition("tag-customer", "Customer report", "blue"),
		tagDefinition("tag-urgent", "Urgent", "red"),
		tagDefinition("tag-release", "Release", "purple"),
	],
	metadataRevision: 7,
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

function tagDefinition(
	id: string,
	name: string,
	color: HermesTagColor,
	revision = 0
): HermesTagDefinition {
	return {
		id,
		name,
		normalizedKey: name.toLocaleLowerCase(),
		color,
		revision,
		createdAt: 1,
		updatedAt: 1,
	};
}

const noopTagActions = {
	onListTagDefinitions: async () => sessionRowFixture.tags,
	onCreateTag: async (name: string, color: HermesTagColor) =>
		tagDefinition("tag-created", name, color),
	onUpdateTag: async (
		_definitionId: string,
		update: { name?: string; color?: HermesTagColor; expectedRevision: number }
	) => tagDefinition("tag-updated", update.name ?? "Updated", update.color ?? "gray", 1),
	onDeleteTag: async (_definitionId: string, _expectedRevision: number) => undefined,
	onAssignTag: async (_definitionId: string) => undefined,
	onUnassignTag: async (_definitionId: string) => undefined,
};

function input(element: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(
		testWindow.HTMLInputElement.prototype,
		"value"
	)?.set;
	setter?.call(element, value);
	element.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
}

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
		setPanelRect: (rect) => {
			activePanelRect = rect;
		},
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
	resizeObserverInstances = [];
	Object.defineProperty(globalThis, "ResizeObserver", {
		configurable: true,
		writable: true,
		value: TestResizeObserver,
	});
	Object.defineProperty(testWindow.HTMLDialogElement.prototype, "scrollHeight", {
		configurable: true,
		get: () => activePanelRect.height,
	});
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
	test("keeps the main menu compact and gives rename a focused keyboard subview", async () => {
		const renameCalls: Array<[string, number]> = [];
		let resolveRename: (() => void) | null = null;
		const onRename = mock(
			(title: string, expectedRevision: number) =>
				new Promise<void>((resolve) => {
					renameCalls.push([title, expectedRevision]);
					resolveRename = resolve;
				})
		);
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		mountedRoot = root;
		await act(async () =>
			root.render(
				<HermesSessionRow
					session={sessionRowFixture}
					selected
					linkedBranch={null}
					actionPending={false}
					deleteDisabledReason={null}
					onSelect={() => undefined}
					onSetArchived={() => undefined}
					onDelete={() => undefined}
					onRename={onRename}
					{...noopTagActions}
				/>
			)
		);

		expect(container.textContent).toContain("Customer report");
		expect(container.textContent).toContain("Urgent");
		expect(container.textContent).toContain("+1");
		expect(container.textContent).not.toContain("Release");
		expect(
			container
				.querySelector<HTMLButtonElement>('button[aria-label^="Open Important session"]')
				?.getAttribute("aria-label")
		).toContain("Tags: Customer report, Urgent, Release");
		const trigger = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Actions for Important session"]'
		);
		if (!trigger) throw new Error("Missing session actions trigger");
		await act(async () => click(trigger));
		const panel = document.querySelector<HTMLDialogElement>("dialog");
		if (!panel) throw new Error("Missing metadata actions panel");
		expect(panel.style.width).toBe("304px");
		expect(panel.textContent).toContain("Rename");
		expect(panel.textContent).toContain("Tags");
		expect(panel.textContent).toContain("Archive");
		expect(panel.querySelector("input")).toBeNull();

		const renameButton = Array.from(panel.querySelectorAll("button")).find((button) =>
			button.textContent?.trim().startsWith("Rename")
		);
		if (!renameButton) throw new Error("Missing rename action");
		await act(async () => click(renameButton));
		const nameInput = panel.querySelector<HTMLInputElement>('input[aria-label="Session name"]');
		if (!nameInput) throw new Error("Missing accessible session name input");
		expect(document.activeElement).toBe(nameInput);
		expect(nameInput.value).toBe("Important session");
		expect(nameInput.className).toContain("h-8");
		expect(panel.textContent).not.toContain("Archive");
		await act(async () => input(nameInput, "Release readiness"));
		const saveName = Array.from(panel.querySelectorAll("button")).find(
			(button) => button.textContent === "Save"
		);
		if (!saveName) throw new Error("Missing save name action");
		await act(async () => {
			nameInput.form?.dispatchEvent(
				new testWindow.Event("submit", {
					bubbles: true,
					cancelable: true,
				}) as unknown as Event
			);
		});
		expect(renameCalls).toEqual([["Release readiness", 7]]);
		expect(saveName.disabled).toBe(true);
		await act(async () => resolveRename?.());
		expect(panel.textContent).toContain("Rename");

		const reopenedRename = Array.from(panel.querySelectorAll("button")).find((button) =>
			button.textContent?.trim().startsWith("Rename")
		);
		if (!reopenedRename) throw new Error("Missing rename action after save");
		await act(async () => click(reopenedRename));
		const escapeInput = panel.querySelector<HTMLInputElement>('input[aria-label="Session name"]');
		if (!escapeInput) throw new Error("Missing rename input after reopening");
		await act(async () => {
			escapeInput.dispatchEvent(
				new testWindow.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}) as unknown as Event
			);
		});
		expect(document.querySelector("dialog")).toBe(panel);
		expect(panel.querySelector('input[aria-label="Session name"]')).toBeNull();
		const focusedRename = Array.from(panel.querySelectorAll("button")).find((button) =>
			button.textContent?.trim().startsWith("Rename")
		);
		expect(document.activeElement === (focusedRename as unknown as Element)).toBe(true);
	});

	test("searches colored definitions and applies selection immediately without hiding failures", async () => {
		const definitions = [
			...sessionRowFixture.tags,
			tagDefinition("tag-follow-up", "Needs follow-up", "amber"),
		];
		const assignCalls: string[] = [];
		const unassignCalls: string[] = [];
		let rejectFirstAssign = true;
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		mountedRoot = root;
		await act(async () =>
			root.render(
				<HermesSessionRow
					session={sessionRowFixture}
					selected
					linkedBranch={null}
					actionPending={false}
					deleteDisabledReason={null}
					onSelect={() => undefined}
					onSetArchived={() => undefined}
					onDelete={() => undefined}
					onRename={async () => undefined}
					{...noopTagActions}
					onListTagDefinitions={async (query) =>
						definitions.filter((tag) =>
							tag.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
						)
					}
					onAssignTag={async (definitionId) => {
						assignCalls.push(definitionId);
						if (rejectFirstAssign) {
							rejectFirstAssign = false;
							throw new Error("Assignment changed elsewhere. Refresh and try again.");
						}
					}}
					onUnassignTag={async (definitionId) => {
						unassignCalls.push(definitionId);
					}}
				/>
			)
		);
		const trigger = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Actions for Important session"]'
		);
		if (!trigger) throw new Error("Missing session actions trigger");
		await act(async () => click(trigger));
		const panel = document.querySelector<HTMLDialogElement>("dialog");
		if (!panel) throw new Error("Missing session actions panel");
		const tagsButton = Array.from(panel.querySelectorAll("button")).find((button) =>
			button.textContent?.trim().startsWith("Tags")
		);
		if (!tagsButton) throw new Error("Missing Tags action");
		await act(async () => click(tagsButton));
		const search = panel.querySelector<HTMLInputElement>('input[aria-label="Search tags"]');
		if (!search) throw new Error("Missing tag search");
		expect(document.activeElement).toBe(search);
		expect(panel.textContent).toContain("Manage tags…");
		expect(panel.querySelector('input[type="checkbox"]:checked')).not.toBeNull();

		await act(async () => input(search, "follow"));
		const followUp = panel.querySelector<HTMLInputElement>(
			'input[aria-label="Assign Needs follow-up"]'
		);
		if (!followUp) throw new Error("Missing filtered tag definition");
		await act(async () => click(followUp));
		expect(assignCalls).toEqual(["tag-follow-up"]);
		expect(panel.querySelector('[role="alert"]')?.textContent).toContain("changed elsewhere");
		expect(followUp.checked).toBe(false);
		await act(async () => click(followUp));
		expect(assignCalls).toEqual(["tag-follow-up", "tag-follow-up"]);
		expect(followUp.checked).toBe(true);

		await act(async () => input(search, "urgent"));
		const urgent = panel.querySelector<HTMLInputElement>('input[aria-label="Unassign Urgent"]');
		if (!urgent) throw new Error("Missing selected tag definition");
		await act(async () => click(urgent));
		expect(unassignCalls).toEqual(["tag-urgent"]);
		expect(urgent.checked).toBe(false);
	});

	test("creates from search with the fixed palette and manages rename, recolor, and confirmed delete", async () => {
		const created: Array<[string, HermesTagColor]> = [];
		const updates: Array<
			[string, { name?: string; color?: HermesTagColor; expectedRevision: number }]
		> = [];
		const deletes: Array<[string, number]> = [];
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		mountedRoot = root;
		await act(async () =>
			root.render(
				<HermesSessionRow
					session={sessionRowFixture}
					selected
					linkedBranch={null}
					actionPending={false}
					deleteDisabledReason={null}
					onSelect={() => undefined}
					onSetArchived={() => undefined}
					onDelete={() => undefined}
					onRename={async () => undefined}
					{...noopTagActions}
					onCreateTag={async (name, color) => {
						created.push([name, color]);
						return tagDefinition("tag-new", name, color);
					}}
					onUpdateTag={async (definitionId, update) => {
						updates.push([definitionId, update]);
						return tagDefinition(
							definitionId,
							update.name ?? "Customer report",
							update.color ?? "blue",
							update.expectedRevision + 1
						);
					}}
					onDeleteTag={async (definitionId, revision) => {
						deletes.push([definitionId, revision]);
					}}
				/>
			)
		);
		const trigger = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Actions for Important session"]'
		);
		if (!trigger) throw new Error("Missing session actions trigger");
		await act(async () => click(trigger));
		const panel = document.querySelector<HTMLDialogElement>("dialog");
		if (!panel) throw new Error("Missing session actions panel");
		const tagsButton = Array.from(panel.querySelectorAll("button")).find((button) =>
			button.textContent?.trim().startsWith("Tags")
		);
		if (!tagsButton) throw new Error("Missing Tags action");
		await act(async () => click(tagsButton));
		const search = panel.querySelector<HTMLInputElement>('input[aria-label="Search tags"]');
		if (!search) throw new Error("Missing tag search");
		await act(async () => input(search, "Launch"));
		const create = Array.from(panel.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Create “Launch”")
		);
		if (!create) throw new Error("Missing create-from-search action");
		await act(async () => click(create));
		expect(panel.querySelectorAll('input[type="radio"]')).toHaveLength(9);
		const gray = panel.querySelector<HTMLInputElement>('input[aria-label="Gray tag color"]');
		const blue = panel.querySelector<HTMLInputElement>('input[aria-label="Blue tag color"]');
		if (!gray || !blue) throw new Error("Missing keyboard palette choices");
		expect(gray.tabIndex).toBe(0);
		expect(blue.tabIndex).toBe(-1);
		gray.focus();
		await act(async () => {
			gray.dispatchEvent(
				new testWindow.KeyboardEvent("keydown", {
					key: "ArrowRight",
					bubbles: true,
					cancelable: true,
				}) as unknown as Event
			);
		});
		expect(document.activeElement).toBe(blue);
		expect(blue.checked).toBe(true);
		expect(blue.tabIndex).toBe(0);
		const purple = panel.querySelector<HTMLInputElement>('input[aria-label="Purple tag color"]');
		if (!purple) throw new Error("Missing purple palette choice");
		await act(async () => click(purple));
		const confirmCreate = Array.from(panel.querySelectorAll("button")).find(
			(button) => button.textContent === "Create tag"
		);
		if (!confirmCreate) throw new Error("Missing create tag confirmation");
		await act(async () => click(confirmCreate));
		expect(created).toEqual([["Launch", "purple"]]);

		const manage = Array.from(panel.querySelectorAll("button")).find(
			(button) => button.textContent === "Manage tags…"
		);
		if (!manage) throw new Error("Missing manage-tags action");
		await act(async () => click(manage));
		expect(panel.textContent).toContain("Manage tags");
		const edit = panel.querySelector<HTMLButtonElement>(
			'button[aria-label="Edit Customer report"]'
		);
		if (!edit) throw new Error("Missing tag edit action");
		await act(async () => click(edit));
		const name = panel.querySelector<HTMLInputElement>('input[aria-label="Tag name"]');
		if (!name) throw new Error("Missing tag name editor");
		await act(async () => input(name, "Customer"));
		const green = panel.querySelector<HTMLInputElement>('input[aria-label="Green tag color"]');
		if (!green) throw new Error("Missing green palette choice");
		await act(async () => click(green));
		const save = Array.from(panel.querySelectorAll("button")).find(
			(button) => button.textContent === "Save tag"
		);
		if (!save) throw new Error("Missing tag save action");
		await act(async () => click(save));
		expect(updates).toEqual([
			["tag-customer", { name: "Customer", color: "green", expectedRevision: 0 }],
		]);
		const updatedEdit = panel.querySelector<HTMLButtonElement>(
			'button[aria-label="Edit Customer"]'
		);
		expect(document.activeElement).toBe(updatedEdit);

		const deleteButton = panel.querySelector<HTMLButtonElement>(
			'button[aria-label="Delete Customer"]'
		);
		if (!deleteButton) throw new Error("Missing tag delete action");
		await act(async () => click(deleteButton));
		expect(panel.textContent).toContain("Delete “Customer” and remove it from every session?");
		expect(deletes).toEqual([]);
		const cancelDelete = Array.from(panel.querySelectorAll("button")).find(
			(button) => button.textContent === "Cancel"
		);
		expect(document.activeElement === (cancelDelete as unknown as Element)).toBe(true);
		const confirmDelete = Array.from(panel.querySelectorAll("button")).find(
			(button) => button.textContent === "Delete tag"
		);
		if (!confirmDelete) throw new Error("Missing explicit tag delete confirmation");
		await act(async () => click(confirmDelete));
		expect(deletes).toEqual([["tag-customer", 1]]);
	});

	test("session row actions are discoverable, keyboard controls that never select the row", async () => {
		const onSelect = mock(() => undefined);
		const onSetArchived = mock(
			(_profileId: string, _durableSessionId: string, _archived: boolean) => undefined
		);
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
					deleteDisabledReason={null}
					onSelect={onSelect}
					onSetArchived={onSetArchived}
					onDelete={onDelete}
					onRename={async () => undefined}
					{...noopTagActions}
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
		expect(onSetArchived).toHaveBeenCalledWith("work", "session-important", true);
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
			'button[aria-label^="Open Important session"]'
		);
		if (!openRow) throw new Error("Missing row selection control");
		await act(async () => click(openRow));
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	test("permanent deletion stays disabled without expanding the menu with its explanation", async () => {
		const reason =
			"Permanent delete is unavailable because stock Hermes cannot atomically verify that a session stayed idle. Archive is the safe cleanup option.";
		const onDelete = mock(() => undefined);
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		mountedRoot = root;
		await act(async () =>
			root.render(
				<HermesSessionRow
					session={sessionRowFixture}
					selected
					linkedBranch={null}
					actionPending={false}
					deleteDisabledReason={reason}
					onSelect={() => undefined}
					onSetArchived={() => undefined}
					onDelete={onDelete}
					onRename={async () => undefined}
					{...noopTagActions}
				/>
			)
		);
		const trigger = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Actions for Important session"]'
		);
		if (!trigger) throw new Error("Missing session actions trigger");
		await act(async () => click(trigger));
		const panel = document.querySelector<HTMLDialogElement>("dialog");
		const deleteButton = Array.from(panel?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent === "Delete permanently…"
		);
		if (!deleteButton) throw new Error("Missing disabled deletion action");
		expect(deleteButton.disabled).toBe(true);
		expect(deleteButton.title).toBe(reason);
		expect(panel?.textContent).not.toContain("Archive is the safe cleanup option");
		expect(
			panel?.querySelector('[aria-label="Why is permanent delete unavailable?"]')
		).not.toBeNull();
		expect(onDelete).not.toHaveBeenCalled();
	});

	test("selected and archived session rows expose the trigger and explicit Unarchive action", async () => {
		const html = renderToStaticMarkup(
			<HermesSessionRow
				session={{ ...sessionRowFixture, archived: true }}
				selected
				linkedBranch={null}
				actionPending={false}
				deleteDisabledReason={null}
				onSelect={() => undefined}
				onSetArchived={() => undefined}
				onDelete={() => undefined}
				onRename={async () => undefined}
				{...noopTagActions}
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
					deleteDisabledReason={null}
					onSelect={() => undefined}
					onSetArchived={() => undefined}
					onDelete={() => undefined}
					onRename={async () => undefined}
					{...noopTagActions}
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

	test("focuses the dialog itself when no enabled actionable control is available", async () => {
		function PanelFallbackHarness() {
			const [open, setOpen] = useState(false);
			return (
				<OverflowPopover label="Empty options" open={open} onOpenChange={setOpen}>
					<button type="button" disabled>
						Unavailable
					</button>
				</OverflowPopover>
			);
		}

		activeLabel = "Empty options";
		activeTriggerRect = { left: 300, top: 200, width: 28, height: 28 };
		activePanelRect = { left: 0, top: 0, width: 360, height: 80 };
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		mountedRoot = root;
		await act(async () => root.render(<PanelFallbackHarness />));
		const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Empty options"]');
		if (!trigger) throw new Error("Missing empty options trigger");
		const panel = await openPopover(trigger);

		expect(panel.tabIndex).toBe(-1);
		expect(document.activeElement).toBe(panel);
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
			test("moves focus into the dialog and wraps forward and reverse Tab navigation", async () => {
				const harness = await mountPopover({
					label: triggerCase.label,
					triggerRect: { left: 500, top: 200, width: 28, height: 28 },
					panelRect: { left: 0, top: 0, width: 360, height: 220 },
				});
				const panel = await openPopover(harness.trigger);
				const enabledActions = Array.from(
					panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
				);
				const firstAction = enabledActions[0];
				const lastAction = enabledActions.at(-1);
				if (!firstAction || !lastAction) throw new Error("Missing enabled popover actions");

				expect(document.activeElement).toBe(firstAction);
				lastAction.focus();
				const forwardTab = new testWindow.KeyboardEvent("keydown", {
					key: "Tab",
					bubbles: true,
					cancelable: true,
				});
				await act(async () => document.dispatchEvent(forwardTab));
				expect(forwardTab.defaultPrevented).toBe(true);
				expect(document.activeElement).toBe(firstAction);

				firstAction.focus();
				const reverseTab = new testWindow.KeyboardEvent("keydown", {
					key: "Tab",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				});
				await act(async () => document.dispatchEvent(reverseTab));
				expect(reverseTab.defaultPrevented).toBe(true);
				expect(document.activeElement).toBe(lastAction);
			});

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
				expect(panel.style.maxHeight).toBe("724px");
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
				expect(panel.style.top).toBe("112px");
				expect(panel.style.width).toBe(`${viewportWidth - 16}px`);
				expect(panel.style.maxHeight).toBe("60px");
				expect(panel.style.overflowY).toBe("auto");
			});

			test("repositions after observed panel and trigger growth and cleans up the observer", async () => {
				const harness = await mountPopover({
					label: triggerCase.label,
					triggerRect: { left: 500, top: 500, width: 28, height: 28 },
					panelRect: { left: 0, top: 0, width: 360, height: 180 },
				});
				const panel = await openPopover(harness.trigger);
				const observer = resizeObserverInstances.find(
					(instance) => instance.observed.has(harness.trigger) && instance.observed.has(panel)
				);
				expect(observer).toBeDefined();
				expect(panel.style.top).toBe("536px");
				expect(panel.style.maxHeight).toBe("256px");

				harness.setPanelRect({ left: 0, top: 0, width: 360, height: 400 });
				await act(async () => observer?.notify(panel));
				expect(panel.style.top).toBe("92px");
				expect(panel.style.maxHeight).toBe("484px");

				harness.setPanelRect({ left: 0, top: 0, width: 360, height: 700 });
				await act(async () => observer?.notify(panel));
				expect(panel.style.top).toBe("8px");
				expect(panel.style.maxHeight).toBe("484px");

				harness.setTriggerRect({ left: 500, top: 100, width: 28, height: 28 });
				await act(async () => observer?.notify(harness.trigger));
				expect(panel.style.top).toBe("136px");
				expect(panel.style.maxHeight).toBe("656px");

				await act(async () =>
					document.dispatchEvent(new testWindow.KeyboardEvent("keydown", { key: "Escape" }))
				);
				expect(document.querySelector("dialog")).toBeNull();
				expect(observer?.disconnected).toBe(true);
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
