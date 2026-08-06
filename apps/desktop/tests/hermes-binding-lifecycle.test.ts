import { describe, expect, test } from "bun:test";
import { HermesBindingLifecycle } from "../src/renderer/hermes/hermes-binding-lifecycle";

const binding = (session: string, claim: string, bindingGeneration = 1) => ({
	connectionId: "connection-1",
	hermesSessionId: session,
	claimId: claim,
	runtimeSessionId: `runtime-${claim}`,
	bindingGeneration,
});

describe("Hermes renderer binding lifecycle", () => {
	test("releases selection changes and cleanup with the exact accepted claim", () => {
		const released: ReturnType<typeof binding>[] = [];
		const lifecycle = new HermesBindingLifecycle((value) => released.push(value));
		const sessionA = lifecycle.select("connection-1:session-a");
		expect(lifecycle.accept(sessionA, binding("session-a", "claim-a"))).toBe(true);

		const sessionB = lifecycle.select("connection-1:session-b");
		lifecycle.releaseObsolete();
		expect(released).toEqual([binding("session-a", "claim-a")]);
		expect(lifecycle.accept(sessionB, binding("session-b", "claim-b"))).toBe(true);
		lifecycle.dispose();
		expect(released).toEqual([binding("session-a", "claim-a"), binding("session-b", "claim-b")]);
	});

	test("rejects a late resume without disturbing the newly selected thread", () => {
		const released: ReturnType<typeof binding>[] = [];
		const lifecycle = new HermesBindingLifecycle((value) => released.push(value));
		const sessionA = lifecycle.select("connection-1:session-a");
		const sessionB = lifecycle.select("connection-1:session-b");
		expect(lifecycle.accept(sessionA, binding("session-a", "claim-a"))).toBe(false);
		expect(lifecycle.accept(sessionB, binding("session-b", "claim-b"))).toBe(true);

		expect(lifecycle.current()).toEqual(binding("session-b", "claim-b"));
		expect(released).toEqual([binding("session-a", "claim-a")]);
	});

	test("rejects async mutation callbacks from an earlier generation after a rapid A-B-A switch", async () => {
		const released: ReturnType<typeof binding>[] = [];
		const mutations: string[] = [];
		const lifecycle = new HermesBindingLifecycle((value) => released.push(value));
		const firstA = lifecycle.select("connection-1:session-a");
		const lateCallbacks = ["release", "submit", "approval", "clarification"].map(
			async (mutation) => {
				await Promise.resolve();
				lifecycle.runIfCurrent(firstA, () => mutations.push(mutation));
			}
		);
		lifecycle.select("connection-1:session-b");
		const secondA = lifecycle.select("connection-1:session-a");
		await Promise.all(lateCallbacks);
		expect(lifecycle.accept(firstA, binding("session-a", "claim-a", 1))).toBe(false);
		expect(lifecycle.accept(secondA, binding("session-a", "claim-a", 2))).toBe(true);

		expect(mutations).toEqual([]);
		expect(lifecycle.current()).toEqual(binding("session-a", "claim-a", 2));
		expect(released).toEqual([binding("session-a", "claim-a", 1)]);
	});
});
