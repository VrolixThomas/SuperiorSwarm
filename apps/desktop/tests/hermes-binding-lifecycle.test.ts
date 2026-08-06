import { describe, expect, test } from "bun:test";
import { HermesBindingLifecycle } from "../src/renderer/hermes/hermes-binding-lifecycle";

const binding = (session: string, claim: string) => ({
	connectionId: "connection-1",
	hermesSessionId: session,
	claimId: claim,
	runtimeSessionId: `runtime-${claim}`,
});

describe("Hermes renderer binding lifecycle", () => {
	test("releases selection changes and cleanup with the exact accepted claim", () => {
		const released: ReturnType<typeof binding>[] = [];
		const lifecycle = new HermesBindingLifecycle((value) => released.push(value));
		lifecycle.select("connection-1:session-a");
		expect(lifecycle.accept("connection-1:session-a", binding("session-a", "claim-a"))).toBe(true);

		lifecycle.select("connection-1:session-b");
		lifecycle.releaseObsolete();
		expect(released).toEqual([binding("session-a", "claim-a")]);
		expect(lifecycle.accept("connection-1:session-b", binding("session-b", "claim-b"))).toBe(true);
		lifecycle.dispose();
		expect(released).toEqual([binding("session-a", "claim-a"), binding("session-b", "claim-b")]);
	});

	test("rejects a late resume without disturbing the newly selected thread", () => {
		const released: ReturnType<typeof binding>[] = [];
		const lifecycle = new HermesBindingLifecycle((value) => released.push(value));
		lifecycle.select("connection-1:session-a");
		lifecycle.select("connection-1:session-b");
		expect(lifecycle.accept("connection-1:session-a", binding("session-a", "claim-a"))).toBe(false);
		expect(lifecycle.accept("connection-1:session-b", binding("session-b", "claim-b"))).toBe(true);

		expect(lifecycle.current()).toEqual(binding("session-b", "claim-b"));
		expect(released).toEqual([binding("session-a", "claim-a")]);
	});
});
