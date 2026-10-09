import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import { installTerminalInput } from "../../src/renderer/components/terminal-input";
import { writeTerminalReplay } from "../../src/renderer/components/terminal-replay";
import { installTerminalWheelHandler } from "../../src/renderer/components/terminal-wheel";
import { encodeTerminalReplay } from "../../src/shared/terminal-replay";

const assert = (condition: unknown, label: string) => {
	if (!condition) throw Error(label);
};
const tick = () =>
	new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
async function run() {
	const container = document.createElement("div");
	container.style.cssText = "width:2800px;height:450px;position:relative";
	document.body.append(container);
	const other = document.createElement("input");
	document.body.append(other);
	other.focus();
	const term = new Terminal({
		allowProposedApi: true,
		cols: 240,
		rows: 24,
		scrollback: 1000,
		scrollSensitivity: 1,
		fastScrollSensitivity: 5,
		smoothScrollDuration: 0,
	});
	term.open(container);
	let visible = true;
	let replay = false;
	const text: string[] = [];
	const binary: string[] = [];
	const inputCleanup = installTerminalInput(
		term,
		() => replay,
		(s) => text.push(s),
		(s) => binary.push(s)
	);
	let cleanup = installTerminalWheelHandler(container, term, () => visible);
	const results: string[] = [];
	const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
	const screen = container.querySelector(".xterm-screen");
	if (!screen) throw Error("missing xterm screen");
	const wheel = (
		dy: number,
		unit: number,
		target: Element = screen,
		extra: WheelEventInit = {}
	) => {
		const rect = screen.getBoundingClientRect();
		const event = new WheelEvent("wheel", {
			bubbles: true,
			cancelable: true,
			deltaY: dy,
			deltaMode: unit,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + 20,
			...extra,
		});
		// Chromium synthetic wheels expose zero-valued legacy deltas. Omit them
		// so xterm exercises the standard deltaY path instead of a no-op.
		Object.defineProperties(event, {
			wheelDelta: { value: undefined },
			wheelDeltaX: { value: undefined },
			wheelDeltaY: { value: undefined },
		});
		target.dispatchEvent(event);
		return event;
	};
	try {
		await write(Array.from({ length: 200 }, (_, i) => `${i}\r\n`).join(""));
		await tick();
		term.scrollToLine(50);
		await tick();
		let scrolls = 0;
		const sub = term.onScroll(() => scrolls++);
		wheel(3, 1);
		await tick();
		assert(
			term.buffer.active.viewportY === 53 && scrolls === 1,
			"LINE moves exactly three rows once"
		);
		wheel(1, 2);
		await tick();
		assert(term.buffer.active.viewportY === 76, "PAGE moves rows minus one");
		assert(document.activeElement === other, "wheel preserves focus in another pane");
		results.push("normal LINE/PAGE, no double-handling, focus");

		// Installing twice replaces the old listener; old cleanup cannot remove the replacement.
		const oldCleanup = cleanup;
		cleanup = installTerminalWheelHandler(container, term, () => visible);
		oldCleanup();
		term.scrollToLine(50);
		wheel(3, 1);
		await tick();
		assert(term.buffer.active.viewportY === 53, "remount has one listener");
		const overlay = document.createElement("button");
		container.append(overlay);
		let ownScrollCalls = 0;
		const originalScroll = term.scrollLines.bind(term);
		term.scrollLines = (n) => {
			ownScrollCalls++;
			originalScroll(n);
		};
		wheel(3, 1, overlay);
		assert(ownScrollCalls === 0, "overlay does not scroll terminal");
		overlay.remove();
		const editor = document.createElement("textarea");
		term.element?.append(editor);
		wheel(3, 1, editor);
		assert(ownScrollCalls === 0, "interactive textarea owns its wheel");
		editor.remove();
		visible = false;
		wheel(3, 1);
		assert(ownScrollCalls === 0, "inactive terminal is not normalized");
		visible = true;
		container.style.visibility = "hidden";
		wheel(3, 1);
		assert(ownScrollCalls === 0, "CSS hidden terminal is not normalized");
		container.style.visibility = "visible";
		wheel(1, 1, container);
		assert(ownScrollCalls === 1, "padding belongs to terminal");
		term.scrollLines = originalScroll;
		results.push("overlays, hidden terminals, padding, replacement/disposal");

		// Compare separate, identically initialized instances: xterm retains
		// fractional pixel state, so sequential reuse is not a valid baseline.
		const pairs = [false, true].map((withAdapter) => {
			const host = document.createElement("div");
			host.style.cssText = container.style.cssText;
			document.body.append(host);
			const terminal = new Terminal({
				allowProposedApi: true,
				cols: 240,
				rows: 24,
				scrollback: 1000,
			});
			terminal.open(host);
			const dispose = withAdapter
				? installTerminalWheelHandler(host, terminal, () => true)
				: () => {};
			return { host, terminal, dispose };
		});
		try {
			for (const pair of pairs) {
				await new Promise<void>((r) => pair.terminal.write("line\r\n".repeat(200), r));
				pair.terminal.scrollToLine(70);
			}
			await tick();
			for (const dy of [0.2, 4, 49, 50, 120, -20]) {
				const positions: number[] = [];
				const prevented: boolean[] = [];
				for (const pair of pairs) {
					const target = pair.host.querySelector(".xterm-screen");
					if (!target) throw Error("missing paired screen");
					const before = pair.terminal.buffer.active.viewportY;
					const event = wheel(dy, 0, target);
					await tick();
					positions.push(pair.terminal.buffer.active.viewportY);
					prevented.push(event.defaultPrevented);
					if (dy >= 49) {
						assert(pair.terminal.buffer.active.viewportY > before, "pixel input actually scrolls");
					}
				}
				assert(
					positions[0] === positions[1] && prevented[0] === prevented[1],
					`pixel baseline ${dy}: ${positions}`
				);
			}
		} finally {
			for (const pair of pairs) {
				pair.dispose();
				pair.terminal.dispose();
				pair.host.remove();
			}
		}
		results.push("real xterm pixel baseline equivalence");

		// A long-running agent can fill scrollback and continue repainting its
		// prompt while the user reads older output.
		term.options.scrollback = 10_000;
		await write("history\r\n".repeat(11_000));
		await tick();
		for (const withAdapter of [false, true]) {
			cleanup();
			if (withAdapter) cleanup = installTerminalWheelHandler(container, term, () => visible);
			term.scrollToBottom();
			await tick();
			for (const unit of withAdapter ? [0, 1, 2] : [0, 1]) {
				const before = term.buffer.active.viewportY;
				wheel(unit === 0 ? -100 : -1, unit);
				await tick();
				const after = term.buffer.active.viewportY;
				assert(after < before, `full scrollback moves up: adapter=${withAdapter}, unit=${unit}`);
				await write("\x1b[?2026h\x1b[24;1Hstatus\x1b[?25h\x1b[?2026l");
				await tick();
				assert(term.buffer.active.viewportY === after, "prompt redraw preserves scroll position");
				await write("\r\nmore output\r\n");
				await tick();
				assert(term.buffer.active.viewportY <= after, "buffer trimming preserves scrolled-up view");
			}
		}
		results.push("full scrollback, ongoing output and prompt redraws");

		const serializer = new SerializeAddon();
		term.loadAddon(serializer);
		const snapshot = encodeTerminalReplay(serializer.serialize(), term.cols, term.rows);
		term.resize(120, 30);
		term.write("stale output");
		const short = encodeTerminalReplay("restored\r\n", 80, 24);
		await new Promise<void>((resolve) => writeTerminalReplay(term, short, resolve));
		assert(
			term.buffer.active.getLine(0)?.translateToString(true) === "restored",
			"reset follows queued output"
		);
		// Different source sizes must apply in parser order even when both arrive
		// before either has finished writing.
		await Promise.all([
			new Promise<void>((resolve) =>
				writeTerminalReplay(term, encodeTerminalReplay("x".repeat(80), 80, 24), resolve)
			),
			new Promise<void>((resolve) =>
				writeTerminalReplay(term, encodeTerminalReplay("final", 60, 20), resolve)
			),
		]);
		assert(term.cols === 120 && term.rows === 30, "back-to-back snapshots preserve pane size");
		assert(
			term.buffer.active.getLine(0)?.translateToString(true) === "final",
			"last replay wins without interleaving"
		);
		for (let i = 0; i < 2; i++) {
			replay = true;
			await new Promise<void>((resolve) => writeTerminalReplay(term, snapshot, resolve));
			replay = false;
			await tick();
			assert(term.cols === 120 && term.rows === 30, "replay restores the current pane dimensions");
			assert(term.buffer.active.baseY > 9000, "replay preserves long history");
			assert(term.buffer.active.length <= 10030, "repeated attachment does not duplicate history");
			term.scrollToBottom();
			const before = term.buffer.active.viewportY;
			wheel(-3, 1);
			await tick();
			assert(term.buffer.active.viewportY === before - 3, "replayed history can be scrolled");
		}
		term.resize(240, 24);
		results.push("snapshot restore, pane resize, repeated attach and scrolling");

		await write("\x1b[?1049h");
		text.length = 0;
		wheel(3, 1);
		wheel(-1, 2);
		assert(text.join("") === "\x1b[B".repeat(3) + "\x1b[A".repeat(23), "alternate CSI repetitions");
		await write("\x1b[?1h");
		text.length = 0;
		wheel(-2, 1);
		assert(text.join("") === "\x1bOA".repeat(2), "alternate SS3 repetitions");
		replay = true;
		text.length = 0;
		wheel(3, 1);
		assert(text.length === 0, "replay suppresses synthetic application input");
		replay = false;
		const originalInput = term.input.bind(term);
		let ownedInputs = 0;
		term.input = (data, user) => {
			ownedInputs++;
			originalInput(data, user);
		};
		const renderedScreen = screen as HTMLElement;
		const screenHeight = renderedScreen.style.height;
		renderedScreen.style.height = "0px";
		await tick();
		wheel(3, 1);
		assert(ownedInputs === 0, "zero-size screen cannot synthesize navigation");
		renderedScreen.style.height = screenHeight;
		await tick();
		term.input = originalInput;

		results.push("alternate CSI/SS3 and replay");

		for (const tracking of [1000, 1002, 1003]) {
			await write(`\x1b[?${tracking}h\x1b[?1006l\x1b[?1016l`);
			binary.length = 0;
			text.length = 0;
			wheel(1, 1);
			assert(binary.length === 1 && text.length === 0, `legacy tracking ${tracking} uses binary`);
			assert(
				[...(binary[0] ?? "")].some((c) => c.charCodeAt(0) >= 128),
				"high-bit coordinate emitted by real xterm"
			);
			replay = true;
			wheel(1, 1);
			assert(binary.length === 1, "replay suppresses binary");
			replay = false;
			await write("\x1b[?1006h");
			binary.length = 0;
			text.length = 0;
			wheel(1, 1);
			assert(binary.length === 0 && text.join("").startsWith("\x1b[<65;"), "SGR stays text");
			await write("\x1b[?1016h");
			text.length = 0;
			wheel(1, 1);
			assert(text.join("").startsWith("\x1b[<65;"), "SGR pixels stay text");
			await write(`\x1b[?${tracking}l`);
		}
		await write("\x1b[?1049l\x1b[?1006l\x1b[?1016l\x1b[?9h");
		binary.length = 0;
		text.length = 0;
		wheel(1, 1);
		assert(binary.length === 0 && text.length === 0, "X10 emits no wheel report");
		await write("\x1b[?9l\x1b[?1006h");
		term.scrollToLine(50);
		wheel(3, 1);
		await tick();
		assert(
			term.buffer.active.viewportY === 53 && binary.length === 0 && text.length === 0,
			"encoding alone does not own scrollback"
		);
		results.push("legacy high bits, SGR, SGR pixels, X10, encoding-only");
		sub.dispose();
		return results;
	} finally {
		cleanup();
		inputCleanup();
		term.dispose();
		container.remove();
		other.remove();
	}
}
(window as unknown as { terminalWheelTests: Promise<string[]> }).terminalWheelTests = run();
