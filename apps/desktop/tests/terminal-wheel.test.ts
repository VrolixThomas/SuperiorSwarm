import { describe, expect, test } from "bun:test";
import { createTerminalWheelHandler } from "../src/renderer/components/terminal-wheel";

function fixture() {
	const normal = { type: "normal" as const, baseY: 100, viewportY: 50 };
	const alternate = { type: "alternate" as const, baseY: 0, viewportY: 0 };
	const calls: number[] = [];
	const input: Array<[string, boolean | undefined]> = [];
	const term = {
		rows: 24,
		buffer: { active: normal as typeof normal | typeof alternate },
		modes: {
			mouseTrackingMode: "none" as "none" | "x10" | "vt200" | "drag" | "any",
			applicationCursorKeysMode: false,
		},
		options: { macOptionClickForcesSelection: false, disableStdin: false },
		scrollLines(n: number) {
			calls.push(n);
			normal.viewportY = Math.max(0, Math.min(normal.baseY, normal.viewportY + n));
		},
		input(s: string, user?: boolean) {
			input.push([s, user]);
		},
	};
	let visible = true;
	const handler = createTerminalWheelHandler(term, () => visible, true);
	const event = (deltaY: number, deltaMode = 1, extra: Partial<WheelEvent> = {}) => {
		const e = {
			deltaY,
			deltaMode,
			deltaX: 0,
			deltaZ: 0,
			altKey: false,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			cancelable: true,
			defaultPrevented: false,
			stopped: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
			stopImmediatePropagation() {
				this.stopped = true;
			},
			...extra,
		};
		return e as typeof e & WheelEvent;
	};
	const wheel = (dy: number, mode = 1, extra: Partial<WheelEvent> = {}) => {
		const e = event(dy, mode, extra);
		handler.handle(e);
		return e;
	};
	return {
		term,
		normal,
		alternate,
		calls,
		input,
		handler,
		wheel,
		event,
		hide: () => {
			visible = false;
		},
	};
}

describe("terminal LINE/PAGE wheel ownership", () => {
	test("signed lines and pages scroll exactly once, with Alt once and a one-page cap", () => {
		const f = fixture();
		for (const [dy, mode, alt, expected] of [
			[3, 1, false, 3],
			[-3, 1, false, -3],
			[1, 2, false, 23],
			[-1, 2, false, -23],
			[1, 1, true, 5],
			[1000, 1, true, 23],
		] as const) {
			f.normal.viewportY = 50;
			const e = f.wheel(dy, mode, { altKey: alt });
			expect(f.calls.at(-1)).toBe(expected);
			expect(e.defaultPrevented && e.stopped).toBe(true);
		}
		expect(f.calls).toHaveLength(6);
		expect(f.input).toEqual([]);
		for (const rows of [1, 24, 60]) {
			f.term.rows = rows;
			f.normal.viewportY = 0;
			f.wheel(1, 2);
			expect(f.calls.at(-1)).toBe(Math.max(1, rows - 1));
		}
	});

	test("fractional residue survives slow events, reverses symmetrically, and resets for units/buffers", () => {
		const f = fixture();
		f.wheel(0.4);
		f.wheel(0.4);
		expect(f.calls).toEqual([]);
		f.wheel(0.4);
		expect(f.calls).toEqual([1]);
		f.wheel(-0.4);
		f.wheel(-0.4);
		expect(f.calls).toEqual([1]);
		f.wheel(-0.4);
		expect(f.calls).toEqual([1, -1]);
		f.wheel(0.75);
		f.wheel(0.02, 2);
		expect(f.calls).toEqual([1, -1]);
		f.wheel(0.75);
		f.term.buffer.active = f.alternate;
		f.wheel(0.4);
		expect(f.input).toEqual([]);
		f.term.buffer.active = f.normal;
		f.wheel(0.4);
		expect(f.calls).toEqual([1, -1]);
	});

	test("ten decimal fractions produce one row in either direction", () => {
		const f = fixture();
		for (let i = 0; i < 10; i++) f.wheel(0.1);
		expect(f.calls).toEqual([1]);
		for (let i = 0; i < 10; i++) f.wheel(-0.1);
		expect(f.calls).toEqual([1, -1]);
	});

	test("outward boundary residue is discarded and empty normal buffer never emits arrows", () => {
		const f = fixture();
		f.normal.viewportY = 0;
		const top = f.wheel(-0.9);
		expect(top.defaultPrevented).toBe(true);
		f.wheel(0.2);
		expect(f.calls).toEqual([]);
		f.normal.viewportY = 100;
		f.wheel(0.9);
		f.wheel(-0.2);
		expect(f.calls).toEqual([]);
		f.normal.baseY = 0;
		f.normal.viewportY = 0;
		f.wheel(1, 2);
		expect(f.input).toEqual([]);
		expect(f.calls).toEqual([]);
	});

	test("pixels pass through exactly and reset owned residue, including legacy fields and momentum", () => {
		const f = fixture();
		f.wheel(0.9);
		for (const dy of [0.01, -0.1, 4, 49, 50, 120, 10000]) {
			const e = Object.assign(f.event(dy, 0), { wheelDelta: -120, wheelDeltaY: -120 });
			const snapshot = { ...e };
			f.handler.handle(e);
			expect(e).toEqual(snapshot);
		}
		f.wheel(0.2);
		expect(f.calls).toEqual([]);
		expect(f.input).toEqual([]);
	});

	test("tracking modes, gestures, horizontal motion, invalid and unowned events stay with xterm", () => {
		const f = fixture();
		for (const mode of ["x10", "vt200", "drag", "any"] as const) {
			f.term.modes.mouseTrackingMode = mode;
			expect(f.wheel(3).defaultPrevented).toBe(false);
			f.term.buffer.active = f.alternate;
			expect(f.wheel(1, 2).defaultPrevented).toBe(false);
			f.term.buffer.active = f.normal;
		}
		f.term.modes.mouseTrackingMode = "none";
		for (const extra of [
			{ ctrlKey: true },
			{ metaKey: true },
			{ shiftKey: true },
			{ deltaX: 0.01 },
			{ deltaZ: 1 },
			{ cancelable: false },
			{ defaultPrevented: true },
		]) {
			const e = f.event(3, 1, extra);
			const before = { ...e };
			f.handler.handle(e);
			expect(e).toEqual(before);
		}
		for (const dy of [0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
			expect(f.wheel(dy).stopped).toBe(false);
		expect(f.wheel(1, 99).stopped).toBe(false);
		f.term.options.macOptionClickForcesSelection = true;
		expect(f.wheel(1, 1, { altKey: true }).stopped).toBe(false);
		f.hide();
		expect(f.wheel(3).stopped).toBe(false);
		expect(f.calls).toEqual([]);
		expect(f.input).toEqual([]);
	});

	test("alternate screen tracking-off uses bounded CSI/SS3 repetitions through public input", () => {
		const f = fixture();
		f.term.buffer.active = f.alternate;
		f.wheel(3);
		f.wheel(-2);
		f.term.modes.applicationCursorKeysMode = true;
		f.wheel(-1, 2);
		f.wheel(2, 1, { altKey: true });
		expect(f.input).toEqual([
			["\x1b[B".repeat(3), true],
			["\x1b[A".repeat(2), true],
			["\x1bOA".repeat(23), true],
			["\x1bOB".repeat(10), true],
		]);
		expect(f.calls).toEqual([]);
		expect(f.wheel(100, 0).stopped).toBe(false);
		f.term.rows = 0;
		expect(f.wheel(1).stopped).toBe(false);
	});
});
