import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { QueuePermissions } from "../src/main/agent-hooks/queue-permissions";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";

function fixture() {
	let now = 1000;
	let generation: string | null = "g1";
	const service = new QueuePermissions({ currentGeneration: () => generation, now: () => now });
	const target = {
		type: "terminal" as const,
		entity: { kind: "workspace" as const, id: "w" },
		workspaceId: "w",
		terminalId: "t",
		provider: "claude",
		providerSessionId: "c",
	};
	const requestId = randomUUID();
	const replies: unknown[] = [];
	const request = {
		requestId,
		issuedAt: now,
		allowOnce: true,
		target,
		generation: "g1",
		summary: "Bash: printf synthetic",
		reply: (value: unknown) => {
			replies.push(value);
			return true;
		},
	};
	const item = {
		id: "source",
		revision: 1,
		members: [{ id: "source", revision: 1 }],
		target,
		permission: { requestId, outcome: "pending" },
		situation: "agent-permission",
		stale: false,
	} as WorkspaceQueueItem;
	const input = {
		id: item.id,
		revision: item.revision,
		members: item.members,
		requestId,
		action: "allow-once" as const,
	};
	return {
		service,
		request,
		item,
		input,
		replies,
		time: (value: number) => {
			now = value;
		},
		generation: (value: string | null) => {
			generation = value;
		},
	};
}

describe("permission request lifecycle (transport stand-ins)", () => {
	test("exact waiting request sends once; stdout receipt is not execution", () => {
		const f = fixture();
		expect(f.service.register(f.request)).toBe(true);
		expect(f.service.capability(f.item).state).toBe("waiting");
		expect(f.replies).toHaveLength(0);
		expect(f.service.decide(f.input, f.item).status).toBe("sent");
		expect(f.replies).toHaveLength(1);
		const response = f.replies[0] as { receipt: string; behavior: string };
		expect(response.behavior).toBe("allow");
		expect(f.service.decide(f.input, f.item).status).toBe("conflict");
		expect(f.service.received(f.request.requestId, "wrong")).toBe(false);
		expect(f.service.received(f.request.requestId, response.receipt)).toBe(true);
		expect(f.service.capability(f.item).state).toBe("delivered-to-hook");
		expect(f.service.capability(f.item).detail).toContain("unknown");
		f.service.close();
	});
	test.each(["deny", "open"] as const)("specific %s response", (action) => {
		const f = fixture();
		f.service.register(f.request);
		expect(f.service.decide({ ...f.input, action }, f.item).status).toBe(
			action === "open" ? "opened" : "sent"
		);
		expect((f.replies[0] as { behavior?: string }).behavior).toBe(
			action === "open" ? undefined : "deny"
		);
		f.service.close();
	});
	test.each(["revision", "members", "sibling", "generation", "expiry", "disconnect"])(
		"rejects %s",
		(variant) => {
			const f = fixture();
			f.service.register(f.request);
			let item = f.item;
			if (variant === "revision") item = { ...item, revision: 2 };
			if (variant === "members")
				item = { ...item, members: [...item.members!, { id: "sibling-source", revision: 1 }] };
			if (variant === "sibling")
				item = { ...item, target: { ...f.request.target, providerSessionId: "other" } };
			if (variant === "generation") f.generation("g2");
			if (variant === "expiry") f.time(32_000);
			if (variant === "disconnect") f.service.disconnected(f.request.requestId);
			expect(f.service.decide(f.input, item).status).not.toBe("sent");
			expect(f.replies.some((v) => (v as { behavior?: string }).behavior === "allow")).toBe(false);
			f.service.close();
		}
	);
	test("concurrent ambiguous requests cancel both; replay cannot rebind", () => {
		const f = fixture();
		f.service.register(f.request);
		expect(f.service.register({ ...f.request, requestId: randomUUID() })).toBe(false);
		expect(f.service.decide(f.input, f.item).status).toBe("conflict");
		expect(f.service.register(f.request)).toBe(false);
		f.service.close();
	});
	test("lost response stays uncertain without retry", () => {
		const f = fixture();
		f.service.register({ ...f.request, reply: () => false });
		expect(f.service.decide(f.input, f.item).status).toBe("uncertain");
		expect(f.service.decide(f.input, f.item).status).toBe("conflict");
		f.service.close();
	});
	test("legacy/provider unsupported requests have Open fallback", () => {
		const f = fixture();
		expect(f.service.capability(f.item).capability).toBe("unavailable");
		expect(
			f.service.register({ ...f.request, target: { ...f.request.target, provider: "gemini" } })
		).toBe(false);
		f.service.close();
	});
});

test("incomplete action summary blocks Allow server-side but preserves Deny", () => {
	const f = fixture();
	f.service.register({ ...f.request, allowOnce: false });
	expect(f.service.capability(f.item).allowOnce).toBe(false);
	expect(f.service.decide(f.input, f.item).status).toBe("unavailable");
	expect(f.replies).toHaveLength(0);
	expect(f.service.decide({ ...f.input, action: "deny" }, f.item).status).toBe("sent");
	f.service.close();
});
test("resolved request retention is bounded without a 512/4096 lifetime exhaustion", () => {
	const f = fixture();
	for (let i = 0; i < 4500; i++) {
		const issuedAt = 1000 + i * 1000;
		f.time(issuedAt);
		const requestId = randomUUID();
		expect(f.service.register({ ...f.request, requestId, issuedAt })).toBe(true);
		const item = { ...f.item, permission: { requestId, outcome: "pending" as const } };
		expect(f.service.decide({ ...f.input, requestId, action: "open" }, item).status).toBe("opened");
	}
	expect(f.service.register(f.request)).toBe(false);
	f.service.close();
});
test("replacement cancels eagerly without a queue observer", async () => {
	const f = fixture();
	f.service.register(f.request);
	f.generation(null);
	await Bun.sleep(300);
	expect(f.replies).toEqual([{ requestId: f.request.requestId }]);
	f.service.close();
});
test("periodic monitors avoid expensive process inspection but decisions recheck exactly", async () => {
	const f = fixture();
	let checks = 0;
	let exists = true;
	f.service.register({
		...f.request,
		alive: () => {
			checks++;
			return false;
		},
		quickAlive: () => exists,
	});
	await Bun.sleep(300);
	f.service.capability(f.item);
	expect(checks).toBe(0);
	expect(f.service.decide(f.input, f.item).status).toBe("conflict");
	expect(checks).toBe(1);
	expect(f.replies.some((v) => (v as { behavior?: string }).behavior)).toBe(false);
	exists = false;
	f.service.close();
});
