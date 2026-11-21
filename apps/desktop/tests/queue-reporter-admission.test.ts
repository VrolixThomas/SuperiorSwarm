import { expect, test } from "bun:test";
import type { WorkspaceReporter } from "../src/main/activity-queue/agent-source";
import {
	QUEUE_ADMISSION_TTL_MS,
	ReporterAdmissions,
} from "../src/main/activity-queue/reporter-admission";
const owner: WorkspaceReporter = {
	type: "terminal",
	entity: { kind: "workspace", id: "workspace" },
	workspaceId: "workspace",
	terminalId: "terminal",
	provider: "codex",
	providerSessionId: "first",
};
test("first admission stays pending until registration, then pins exactly once", () => {
	const leases = new ReporterAdmissions();
	const lease = leases.issue({ kind: "workspace", id: "workspace" }, "terminal", undefined, 100);
	expect(leases.resolve(lease.token, "workspace", "terminal", null, 101).status).toBe("pending");
	leases.record(owner, 102);
	expect(leases.resolve(lease.token, "workspace", "terminal", owner, 103)).toEqual({
		status: "admitted",
		reporter: owner,
	});
	leases.record({ ...owner, providerSessionId: "replacement" }, 104);
	expect(
		leases.resolve(
			lease.token,
			"workspace",
			"terminal",
			{ ...owner, providerSessionId: "replacement" },
			105
		).status
	).toBe("rejected");
	expect(leases.resolve(lease.token, "workspace", "terminal", owner, 106).status).toBe("rejected");
});
test("unexchanged lease never binds a replacement, sibling, unobserved registration or expired owner", () => {
	const leases = new ReporterAdmissions();
	const lease = leases.issue({ kind: "workspace", id: "workspace" }, "terminal", undefined, 100);
	leases.record(owner, 101);
	leases.record({ ...owner, providerSessionId: "replacement" }, 102);
	expect(
		leases.resolve(
			lease.token,
			"workspace",
			"terminal",
			{ ...owner, providerSessionId: "replacement" },
			103
		).status
	).toBe("rejected");
	const unseen = leases.issue({ kind: "workspace", id: "workspace" }, "terminal", undefined, 200);
	expect(leases.resolve(unseen.token, "workspace", "terminal", owner, 201).status).toBe("rejected");
	const expired = leases.issue({ kind: "workspace", id: "workspace" }, "terminal", undefined, 300);
	leases.record(owner, 301);
	expect(leases.resolve(expired.token, "workspace", "sibling", owner, 302).status).toBe("rejected");
	expect(
		leases.resolve(expired.token, "workspace", "terminal", owner, 300 + QUEUE_ADMISSION_TTL_MS)
			.status
	).toBe("rejected");
});
test("coordinator/provider identity and explicit terminal removal cannot be bypassed", () => {
	const leases = new ReporterAdmissions();
	const lease = leases.issue({ kind: "coordinator", id: "workspace" }, "terminal", "claude", 100);
	leases.record(owner, 101);
	expect(leases.resolve(lease.token, "workspace", "terminal", owner, 102).status).toBe("rejected");
	const closed = leases.issue({ kind: "workspace", id: "workspace" }, "terminal", undefined, 200);
	leases.invalidate("terminal");
	leases.record(owner, 201);
	expect(leases.resolve(closed.token, "workspace", "terminal", owner, 202).status).toBe("rejected");
});

test("initial event-aware wait resolves first generation and rejects replacement before response", async () => {
	const leases = new ReporterAdmissions();
	let current: WorkspaceReporter | null = null;
	const first = leases.issue({ kind: "workspace", id: "workspace" }, "terminal");
	const waiting = leases.wait(first.token, "workspace", "terminal", () => current, 100);
	current = owner;
	leases.record(owner);
	expect(await waiting).toEqual({ status: "admitted", reporter: owner });
	current = null;
	const raced = leases.issue({ kind: "workspace", id: "workspace" }, "terminal");
	const racing = leases.wait(raced.token, "workspace", "terminal", () => current, 100);
	current = owner;
	leases.record(owner);
	current = { ...owner, providerSessionId: "replacement" };
	leases.record(current);
	expect((await racing).status).toBe("rejected");
	const timeout = leases.issue({ kind: "workspace", id: "other" }, "other-terminal");
	expect((await leases.wait(timeout.token, "other", "other-terminal", () => null, 5)).status).toBe(
		"pending"
	);
});
