import { describe, expect, test } from "bun:test";
import { generateToken, isValidBearer } from "../src/main/control-plane/auth";
import { isLoopback } from "../src/main/control-plane/server";

describe("control-plane auth", () => {
	test("generateToken returns 64 hex chars", () => {
		const t = generateToken();
		expect(t).toHaveLength(64);
		expect(/^[0-9a-f]+$/.test(t)).toBe(true);
	});

	test("isValidBearer accepts exact match", () => {
		const t = generateToken();
		expect(isValidBearer(`Bearer ${t}`, t)).toBe(true);
	});

	test("isValidBearer rejects wrong token", () => {
		const a = generateToken();
		const b = generateToken();
		expect(isValidBearer(`Bearer ${b}`, a)).toBe(false);
	});

	test("isValidBearer rejects missing prefix", () => {
		const t = generateToken();
		expect(isValidBearer(t, t)).toBe(false);
	});

	test("isValidBearer rejects empty/undefined header", () => {
		const t = generateToken();
		expect(isValidBearer(undefined, t)).toBe(false);
		expect(isValidBearer("", t)).toBe(false);
	});
});

test("isLoopback denies unknown / undefined remote address", () => {
	expect(isLoopback(undefined)).toBe(false);
	expect(isLoopback("")).toBe(false);
	expect(isLoopback("192.168.1.5")).toBe(false);
	expect(isLoopback("127.0.0.1")).toBe(true);
	expect(isLoopback("::1")).toBe(true);
});
