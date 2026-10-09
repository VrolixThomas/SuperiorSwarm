import type { Terminal } from "@xterm/xterm";

type WheelTerminal = Pick<Terminal, "rows" | "options" | "scrollLines" | "input"> & {
	modes: Pick<Terminal["modes"], "mouseTrackingMode" | "applicationCursorKeysMode">;
	buffer: { active: Pick<Terminal["buffer"]["active"], "type" | "baseY" | "viewportY"> };
};

type ApplicationWheel = {
	cellHeight: () => number;
	mouseReporter: (event: WheelEvent) => ((lines: number) => void) | undefined;
};

// Pixel events in local scrollback keep xterm's native behavior. Application
// pixels are converted to rows before this step, without xterm's damping or
// one-report-per-event cap. No mouse/trackpad inference is needed.
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
	isMac: boolean,
	application?: ApplicationWheel
) {
	let residue = 0;
	let direction = 0;
	let unit = -1;
	let buffer: WheelTerminal["buffer"]["active"] | undefined;
	let rows = 0;
	let applicationCursor = false;
	let alt = false;
	let sensitivity = 1;
	let tracking: WheelTerminal["modes"]["mouseTrackingMode"] = "none";
	let cellHeight = 0;
	const reset = () => {
		residue = 0;
		direction = 0;
		buffer = undefined;
	};
	const handle = (event: WheelEvent) => {
		const active = term.buffer.active;
		if (
			(event.deltaMode !== 0 && event.deltaMode !== 1 && event.deltaMode !== 2) ||
			!Number.isFinite(event.deltaY) ||
			event.deltaY === 0 ||
			!Number.isFinite(event.deltaX) ||
			Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
			event.deltaZ !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			(isMac && event.altKey && term.options.macOptionClickForcesSelection) ||
			event.defaultPrevented ||
			!event.cancelable ||
			!Number.isInteger(term.rows) ||
			term.rows < 1 ||
			((active.type === "alternate" || term.modes.mouseTrackingMode !== "none") &&
				term.options.disableStdin) ||
			!ownsEvent(event)
		) {
			reset();
			return;
		}
		const mouse = term.modes.mouseTrackingMode;
		const report =
			mouse !== "none" && mouse !== "x10" ? application?.mouseReporter(event) : undefined;
		const pixelHeight = application?.cellHeight() ?? 0;
		if (
			(mouse !== "none" && !report) ||
			(event.deltaMode === 0 &&
				((!report && active.type === "normal") ||
					!Number.isFinite(pixelHeight) ||
					pixelHeight <= 0))
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
			sensitivity !== (term.options.scrollSensitivity ?? 1) ||
			tracking !== mouse ||
			cellHeight !== pixelHeight
		)
			residue = 0;
		direction = sign;
		unit = event.deltaMode;
		buffer = active;
		rows = term.rows;
		applicationCursor = term.modes.applicationCursorKeysMode;
		alt = event.altKey;
		sensitivity = term.options.scrollSensitivity ?? 1;
		tracking = mouse;
		cellHeight = pixelHeight;

		// Owned vertical input stays inside this pane, even at a boundary.
		event.preventDefault();
		event.stopImmediatePropagation();
		if (
			!report &&
			active.type === "normal" &&
			(active.baseY === 0 ||
				(sign < 0 && active.viewportY === 0) ||
				(sign > 0 && active.viewportY >= active.baseY))
		) {
			reset();
			return;
		}
		const result = normalizeWheelToRows(
			unit === 0 ? event.deltaY / cellHeight : event.deltaY,
			unit,
			rows,
			alt,
			residue,
			sensitivity,
			term.options.fastScrollSensitivity ?? 5
		);
		residue = result.residue;
		if (!result.lines) return;
		if (report) report(result.lines);
		else if (active.type === "normal") term.scrollLines(result.lines);
		else {
			const sequence = `\x1b${applicationCursor ? "O" : "["}${result.lines < 0 ? "A" : "B"}`;
			term.input(sequence.repeat(Math.abs(result.lines)), true);
		}
	};
	return { handle, reset };
}

// One capture listener precedes xterm 6's descendant viewport listener. Local
// scrollback, alternate navigation and SGR wheel input use public APIs.
// Returning a custom-wheel callback alone would be too late for the viewport.
type MouseEncoding = "sgr" | "sgr-pixels" | undefined;
const installed = new WeakMap<
	HTMLElement,
	{
		term: Terminal;
		encoding: () => MouseEncoding;
		dispose: () => void;
	}
>();
export function installTerminalWheelHandler(
	container: HTMLElement,
	term: Terminal,
	isVisible: () => boolean
): () => void {
	const previous = installed.get(container);
	let encoding = previous?.term === term ? previous.encoding() : undefined;
	previous?.dispose();
	const surface = term.element?.querySelector(".xterm-screen");
	if (!surface) return () => {};
	let sized = false;
	let screenHeight = 0;
	const measure = (width: number, height: number) => {
		sized = width > 0 && height > 0;
		screenHeight = height;
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
		/Mac/.test(navigator.platform),
		{
			cellHeight: () => screenHeight / term.rows,
			mouseReporter: (event) => {
				// Legacy binary and X10 remain with xterm. Codex's SGR protocol
				// can express repeated wheel reports without encoding binary bytes.
				if (!encoding) return;
				const bounds = surface.getBoundingClientRect();
				if (bounds.width <= 0 || bounds.height <= 0) return;
				const x = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width - 1);
				const y = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height - 1);
				if (!Number.isFinite(x) || !Number.isFinite(y)) return;
				// Match xterm 6: SGR cell coordinates are one-based; its SGR pixel
				// encoding reports floored CSS pixels relative to the screen.
				const col =
					encoding === "sgr" ? Math.floor(x / (bounds.width / term.cols)) + 1 : Math.floor(x);
				const row =
					encoding === "sgr" ? Math.floor(y / (bounds.height / term.rows)) + 1 : Math.floor(y);
				return (lines) => {
					const button = (lines < 0 ? 64 : 65) + (event.altKey ? 8 : 0);
					term.input(`\x1b[<${button};${col};${row}M`.repeat(Math.abs(lines)), true);
				};
			},
		}
	);
	// Observe encoding changes through the public parser. Returning false lets
	// xterm process them normally, including clicks, drags and pointer motion.
	const modeHandlers = ["h", "l"].map((final) =>
		term.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
			for (const mode of params) {
				if (mode !== 1006 && mode !== 1016) continue;
				const next = final === "h" ? (mode === 1006 ? "sgr" : "sgr-pixels") : undefined;
				if (encoding !== next) handler.reset();
				encoding = next;
			}
			return false;
		})
	);
	const resetHandler = term.parser.registerEscHandler({ final: "c" }, () => {
		encoding = undefined;
		handler.reset();
		return false;
	});
	observer.observe(surface);
	const bufferChange = term.buffer.onBufferChange(handler.reset);
	container.addEventListener("wheel", handler.handle, { capture: true, passive: false });
	const dispose = () => {
		container.removeEventListener("wheel", handler.handle, true);
		observer.disconnect();
		bufferChange.dispose();
		for (const handler of modeHandlers) handler.dispose();
		resetHandler.dispose();
		handler.reset();
		if (installed.get(container)?.dispose === dispose) installed.delete(container);
	};
	installed.set(container, { term, encoding: () => encoding, dispose });
	return dispose;
}
