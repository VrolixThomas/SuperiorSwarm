import { describe, expect, test } from "bun:test";
import { finishOrder } from "../src/hero/build-v4/agentOrder";

describe("agent-order-v4", () => {
	test("returns a permutation of indices 0..n-1", () => {
		const n = 6;
		const order = finishOrder(n);
		expect(order.length).toBe(n);
		expect(new Set(order).size).toBe(n);
		for (const i of order) {
			expect(i).toBeGreaterThanOrEqual(0);
			expect(i).toBeLessThan(n);
		}
	});

	test("first to finish is a middle index, not 0 or n-1", () => {
		const order = finishOrder(6);
		expect(order[0]).not.toBe(0);
		expect(order[0]).not.toBe(5);
	});

	test("is deterministic", () => {
		expect(finishOrder(6)).toEqual(finishOrder(6));
	});
});
