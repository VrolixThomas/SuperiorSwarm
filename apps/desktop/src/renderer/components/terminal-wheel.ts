import type { Terminal } from "@xterm/xterm";

type WheelTerminal = Pick<Terminal, "rows" | "options" | "scrollLines" | "input"> & {
	modes: Pick<Terminal["modes"], "mouseTrackingMode" | "applicationCursorKeysMode">;
	buffer: { active: Pick<Terminal["buffer"]["active"], "type" | "baseY" | "viewportY"> };
};

// Pixel deltas intentionally stay with xterm, including legacy wheel fields.
// This helper only converts standard LINE/PAGE units; no device inference.
export function normalizeWheelToRows(
	deltaY: number,
	unit: number,
	rows: number,
	alt: boolean,
	residue: number,
	sensitivity = 1,
	fastSensitivity = 5
) {
	const page = Math.max(1, rows - 1);
	// Page events already describe a whole viewport. Line events share the
	// configured wheel speed with xterm's pixel path.
	const raw = deltaY * (unit === 2 ? page : sensitivity) * (alt ? fastSensitivity : 1);
	let total = residue + Math.max(-page, Math.min(page, raw));
	// Decimal wheel fractions (e.g. ten 0.1 rows) can land just below an
	// integer in IEEE-754. Correct rounding error without a minimum step.
	const nearest = Math.round(total);
	if (Math.abs(total - nearest) <= Number.EPSILON * Math.max(1, Math.abs(total)) * 4)
		total = nearest;
	const lines = Math.trunc(total);
	return { lines, residue: total - lines };
}

export function createTerminalWheelHandler(
	term: WheelTerminal,
	ownsEvent: (event: WheelEvent) => boolean,
	isMac: boolean
) {
	let residue = 0;
	let direction = 0;
	let unit = -1;
	let buffer: WheelTerminal["buffer"]["active"] | undefined;
	let rows = 0;
	let applicationCursor = false;
	let alt = false;
	let sensitivity = 1;
	const reset = () => {
		residue = 0;
		direction = 0;
		buffer = undefined;
	};
	const handle = (event: WheelEvent) => {
		const active = term.buffer.active;
		if (
			(event.deltaMode !== 1 && event.deltaMode !== 2) ||
			!Number.isFinite(event.deltaY) ||
			event.deltaY === 0 ||
			event.deltaX !== 0 ||
			event.deltaZ !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			(isMac && event.altKey && term.options.macOptionClickForcesSelection) ||
			event.defaultPrevented ||
			!event.cancelable ||
			!Number.isInteger(term.rows) ||
			term.rows < 1 ||
			term.modes.mouseTrackingMode !== "none" ||
			(active.type === "alternate" && term.options.disableStdin) ||
			!ownsEvent(event)
		) {
			reset();
			return;
		}

		const sign = Math.sign(event.deltaY);
		if (
			direction !== sign ||
			unit !== event.deltaMode ||
			buffer !== active ||
			rows !== term.rows ||
			applicationCursor !== term.modes.applicationCursorKeysMode ||
			alt !== event.altKey ||
			sensitivity !== (term.options.scrollSensitivity ?? 1)
		)
			residue = 0;
		direction = sign;
		unit = event.deltaMode;
		buffer = active;
		rows = term.rows;
		applicationCursor = term.modes.applicationCursorKeysMode;
		alt = event.altKey;
		sensitivity = term.options.scrollSensitivity ?? 1;

		// Owned vertical input stays inside this pane, even at a boundary.
		event.preventDefault();
		event.stopImmediatePropagation();
		if (
			active.type === "normal" &&
			(active.baseY === 0 ||
				(sign < 0 && active.viewportY === 0) ||
				(sign > 0 && active.viewportY >= active.baseY))
		) {
			reset();
			return;
		}
		const result = normalizeWheelToRows(
			event.deltaY,
			unit,
			rows,
			alt,
			residue,
			sensitivity,
			term.options.fastScrollSensitivity ?? 5
		);
		residue = result.residue;
		if (!result.lines) return;
		if (active.type === "normal") term.scrollLines(result.lines);
		else {
			const sequence = `\x1b${applicationCursor ? "O" : "["}${result.lines < 0 ? "A" : "B"}`;
			term.input(sequence.repeat(Math.abs(result.lines)), true);
		}
	};
	return { handle, reset };
}

// One capture listener precedes xterm 6's descendant viewport listener. Both
// local scrollback and tracking-off alternate navigation use public APIs.
// Returning a custom-wheel callback alone would be too late for the viewport.
const installed = new WeakMap<HTMLElement, () => void>();
export function installTerminalWheelHandler(
	container: HTMLElement,
	term: Terminal,
	isVisible: () => boolean
): () => void {
	installed.get(container)?.();
	const surface = term.element?.querySelector(".xterm-screen");
	if (!surface) return () => {};
	let sized = false;
	const measure = (width: number, height: number) => {
		sized = width > 0 && height > 0;
	};
	const rect = surface.getBoundingClientRect();
	measure(rect.width, rect.height);
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) measure(entry.contentRect.width, entry.contentRect.height);
		if (!sized) handler.reset();
	});
	const handler = createTerminalWheelHandler(
		term,
		(event) => {
			if (
				!sized ||
				!isVisible() ||
				!surface.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
			)
				return false;
			const target = event.target;
			if (!(target instanceof Element)) return false;
			if (target === container) return true; // padding belongs to this terminal
			if (!term.element?.contains(target)) return false;
			return !target.closest(
				'button, a, input, select, textarea:not(.xterm-helper-textarea), [contenteditable="true"], [role="dialog"], [data-terminal-wheel-ignore]'
			);
		},
		/Mac/.test(navigator.platform)
	);
	observer.observe(surface);
	const bufferChange = term.buffer.onBufferChange(handler.reset);
	container.addEventListener("wheel", handler.handle, { capture: true, passive: false });
	const dispose = () => {
		container.removeEventListener("wheel", handler.handle, true);
		observer.disconnect();
		bufferChange.dispose();
		handler.reset();
		if (installed.get(container) === dispose) installed.delete(container);
	};
	installed.set(container, dispose);
	return dispose;
}
