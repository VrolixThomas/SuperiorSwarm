import { describe, expect, test } from "bun:test";
import {
	type DetectorKeyEvent,
	createDoubleShiftDetector,
} from "../src/renderer/hooks/double-shift-detector";

function shift(overrides: Partial<DetectorKeyEvent> = {}): DetectorKeyEvent {
	return { key: "Shift", metaKey: false, ctrlKey: false, altKey: false, ...overrides };
}

function key(k: string): DetectorKeyEvent {
	return { key: k, metaKey: false, ctrlKey: false, altKey: false };
}

function tap(d: ReturnType<typeof createDoubleShiftDetector>, downAt: number, upAt: number) {
	d.keydown(shift(), downAt);
	d.keyup(shift(), upAt);
}

describe("createDoubleShiftDetector", () => {
	test("two clean taps within 400ms trigger", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		tap(d, 200, 250);
		expect(fired).toBe(1);
	});

	test("taps more than 400ms apart do not trigger", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		tap(d, 500, 550);
		expect(fired).toBe(0);
	});

	test("shift used as modifier (other key while held) does not count", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		d.keydown(shift(), 0);
		d.keydown(key("A"), 10);
		d.keyup(shift(), 50);
		tap(d, 100, 150);
		expect(fired).toBe(0);
	});

	test("non-shift key between two taps resets the sequence", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		d.keydown(key("a"), 100);
		tap(d, 200, 250);
		expect(fired).toBe(0);
	});

	test("non-shift keyup between two taps resets the sequence", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		d.keyup(key("a"), 100);
		tap(d, 200, 250);
		expect(fired).toBe(0);
	});

	test("shift pressed with meta held does not count", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		d.keydown(shift({ metaKey: true }), 0);
		d.keyup(shift({ metaKey: true }), 50);
		tap(d, 100, 150);
		expect(fired).toBe(0);
	});

	test("gap measured between keyups: long-held first tap still chains", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 600);
		tap(d, 700, 750);
		expect(fired).toBe(1);
	});

	test("state resets after firing: four taps fire twice, three fire once", () => {
		let fired = 0;
		const d = createDoubleShiftDetector(() => fired++);
		tap(d, 0, 50);
		tap(d, 100, 150);
		tap(d, 200, 250);
		expect(fired).toBe(1);
		tap(d, 300, 350);
		expect(fired).toBe(2);
	});
});
