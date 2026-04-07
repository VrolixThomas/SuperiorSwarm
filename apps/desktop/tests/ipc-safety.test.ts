import { afterEach, describe, expect, test } from "bun:test";
import { inspect, isCloneable, setDebugMode } from "../src/main/ipc-safety";

describe("inspect", () => {
	test("plain object has no issues", () => {
		const result = inspect({ a: 1, b: "two", c: true, d: null }, "test");
		expect(result.issues).toEqual([]);
	});

	test("array of primitives has no issues", () => {
		const result = inspect([1, 2, 3, "four", true, null], "test");
		expect(result.issues).toEqual([]);
	});

	test("nested plain objects have no issues", () => {
		const result = inspect({ a: { b: { c: { d: "deep" } } } }, "test");
		expect(result.issues).toEqual([]);
	});

	test("Date is allowed", () => {
		const result = inspect({ when: new Date() }, "test");
		expect(result.issues).toEqual([]);
	});

	test("RegExp is allowed", () => {
		const result = inspect({ re: /foo/g }, "test");
		expect(result.issues).toEqual([]);
	});

	test("Map with primitive values is allowed", () => {
		const result = inspect({ m: new Map([["k", "v"]]) }, "test");
		expect(result.issues).toEqual([]);
	});

	test("Set with primitive values is allowed", () => {
		const result = inspect({ s: new Set([1, 2, 3]) }, "test");
		expect(result.issues).toEqual([]);
	});

	test("Map with class-instance value is detected", () => {
		class Bad {}
		const result = inspect({ m: new Map([["k", new Bad()]]) }, "root");
		expect(result.issues.some((i) => i.includes("class instance Bad"))).toBe(true);
	});

	test("Set with function value is detected", () => {
		const result = inspect({ s: new Set([() => "x"]) }, "root");
		expect(result.issues.some((i) => i.includes("function"))).toBe(true);
	});

	test("ArrayBuffer is allowed", () => {
		const result = inspect({ buf: new ArrayBuffer(8) }, "test");
		expect(result.issues).toEqual([]);
	});

	test("Uint8Array is allowed", () => {
		const result = inspect({ arr: new Uint8Array([1, 2, 3]) }, "test");
		expect(result.issues).toEqual([]);
	});

	test("circular references are silently handled (not reported as issues)", () => {
		const obj: Record<string, unknown> = { a: 1 };
		obj["self"] = obj;
		const result = inspect(obj, "root");
		// Cycles are NOT reported — structuredClone handles them fine
		expect(result.issues).toEqual([]);
	});

	test("function value is detected", () => {
		const result = inspect({ fn: () => "hi" }, "root");
		expect(result.issues).toContain("function at root.fn");
	});

	test("symbol value is detected", () => {
		const result = inspect({ sym: Symbol("foo") }, "root");
		expect(result.issues).toContain("symbol at root.sym");
	});

	test("class instance is detected", () => {
		class MyClass {
			x = 1;
		}
		const result = inspect({ instance: new MyClass() }, "root");
		expect(result.issues.some((i) => i.includes("class instance MyClass"))).toBe(true);
		expect(result.issues.some((i) => i.includes("root.instance"))).toBe(true);
	});

	test("max depth is reported", () => {
		// Build a 60-level nested chain
		const root: Record<string, unknown> = {};
		let cur = root;
		for (let i = 0; i < 60; i++) {
			const next: Record<string, unknown> = {};
			cur["child"] = next;
			cur = next;
		}
		const result = inspect(root, "root");
		expect(result.issues.some((i) => i.includes("max depth"))).toBe(true);
	});

	test("walker stops collecting after MAX_ISSUES", () => {
		const obj: Record<string, () => string> = {};
		for (let i = 0; i < 50; i++) {
			obj[`fn${i}`] = () => "x";
		}
		const result = inspect(obj, "root");
		expect(result.issues.length).toBeLessThanOrEqual(20);
	});

	test("array index appears in path", () => {
		const result = inspect([{ ok: true }, () => "x"], "root");
		expect(result.issues).toContain("function at root[1]");
	});

	test("getter that throws is recorded, not crashed on", () => {
		const obj = {};
		Object.defineProperty(obj, "bad", {
			enumerable: true,
			get() {
				throw new Error("nope");
			},
		});
		const result = inspect({ obj }, "root");
		expect(result.issues.some((i) => i.includes("getter threw at root.obj.bad"))).toBe(true);
	});

	test("null prototype object is treated as plain", () => {
		const obj = Object.create(null);
		obj.a = 1;
		const result = inspect({ obj }, "root");
		expect(result.issues).toEqual([]);
	});
});

describe("isCloneable", () => {
	test("returns true for plain values", () => {
		expect(isCloneable({ a: 1, b: "two" }, "test")).toBe(true);
	});

	test("returns true for arrays", () => {
		expect(isCloneable([1, 2, 3], "test")).toBe(true);
	});

	test("returns true for Date", () => {
		expect(isCloneable(new Date(), "test")).toBe(true);
	});

	test("returns true for circular references (structuredClone handles them)", () => {
		const obj: Record<string, unknown> = {};
		obj["self"] = obj;
		expect(isCloneable(obj, "test")).toBe(true);
	});

	test("returns false for function value", () => {
		expect(isCloneable({ fn: () => "x" }, "test")).toBe(false);
	});

	test("returns false for symbol value", () => {
		expect(isCloneable({ sym: Symbol("x") }, "test")).toBe(false);
	});

	test("returns false for class instance", () => {
		class C {}
		expect(isCloneable({ c: new C() }, "test")).toBe(false);
	});
});

describe("isCloneable in debug mode", () => {
	afterEach(() => {
		setDebugMode(false);
	});

	test("returns true on failure when debug mode is enabled", () => {
		setDebugMode(true);
		expect(isCloneable({ fn: () => "x" }, "test")).toBe(true);
		expect(isCloneable({ sym: Symbol("x") }, "test")).toBe(true);
	});

	test("setDebugMode(false) restores blocking behavior", () => {
		setDebugMode(true);
		expect(isCloneable({ fn: () => "x" }, "test")).toBe(true);
		setDebugMode(false);
		expect(isCloneable({ fn: () => "x" }, "test")).toBe(false);
	});
});
