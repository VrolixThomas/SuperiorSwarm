import { describe, expect, test } from "bun:test";
import { HermesSelectionGuard } from "../src/renderer/hermes/hermes-binding-lifecycle";

describe("Hermes renderer selection guard", () => {
	test("changes generations without owning or releasing a Hermes session", () => {
		const guard = new HermesSelectionGuard();
		const sessionA = guard.select("connection-1:session-a");
		const sameA = guard.select("connection-1:session-a");
		const sessionB = guard.select("connection-1:session-b");

		expect(sameA).toEqual(sessionA);
		expect(sessionB.generation).toBe(sessionA.generation + 1);
		expect(guard.isCurrent(sessionA)).toBe(false);
		expect(guard.isCurrent(sessionB)).toBe(true);
	});

	test("rejects late async callbacks after a rapid A-B-A switch", async () => {
		const guard = new HermesSelectionGuard();
		const mutations: string[] = [];
		const firstA = guard.select("connection-1:session-a");
		const callback = Promise.resolve().then(() =>
			guard.runIfCurrent(firstA, () => mutations.push("late-a"))
		);
		guard.select("connection-1:session-b");
		const secondA = guard.select("connection-1:session-a");
		await callback;

		expect(mutations).toEqual([]);
		expect(guard.runIfCurrent(secondA, () => mutations.push("current-a"))).toBe(true);
		expect(mutations).toEqual(["current-a"]);
	});

	test("invalidates pending callbacks on disposal without any release operation", () => {
		const guard = new HermesSelectionGuard();
		const selection = guard.select("connection-1:session-a");
		guard.dispose();
		expect(guard.isCurrent(selection)).toBe(false);
		guard.activate();
		expect(guard.isCurrent(guard.select("connection-1:session-a"))).toBe(true);
	});
});
