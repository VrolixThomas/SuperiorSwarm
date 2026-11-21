import { describe, expect, test } from "bun:test";
import { transitionAgentEvent as transition } from "../src/main/activity-queue/agent-event-transition";
import type { AgentEvent } from "../src/shared/agent-events";
import { admitAgentEvidence } from "../src/shared/agent-evidence";
function event(rawEvent: string, extra: Partial<AgentEvent> = {}): AgentEvent {
	return {
		sessionId: "terminal",
		terminalId: "terminal",
		providerSessionId: "conversation",
		workspaceId: "workspace",
		cwd: "/tmp/synthetic",
		agent: "claude",
		timestamp: 100,
		alert:
			rawEvent === "Stop"
				? "task-complete"
				: ["PermissionRequest", "StopFailure"].includes(rawEvent)
					? "needs-input"
					: "active",
		rawEvent,
		turnId: "turn-1",
		...extra,
	};
}
for (const provider of ["claude", "codex"])
	describe(provider, () => {
		test("Stop and tool activity retain unresolved permission and actual request text", () => {
			let state = transition(
				null,
				event("PermissionRequest", {
					agent: provider,
					permission: { requestId: "request-1", outcome: "pending" },
					evidence: admitAgentEvidence(
						{ permission_prompt: "Allow synthetic status update?" },
						provider,
						"PermissionRequest"
					),
				})
			);
			for (const rawEvent of ["PostToolUse", "Stop", "StopFailure"]) {
				state = transition(
					state?.snapshot,
					event(rawEvent, {
						agent: provider,
						evidence: admitAgentEvidence(
							{ last_assistant_message: "Which color: amber or blue?" },
							provider,
							rawEvent
						),
					})
				);
				expect(state?.attention?.kind).toBe("agent-input");
				expect(state?.attention?.permission?.outcome).toBe("unconfirmed");
				expect(state?.attention?.reason.code).toBe("permission-unresolved");
				expect(
					state?.attention?.evidence.some((e) => e.text === "Allow synthetic status update?")
				).toBe(true);
			}
			expect(state?.attention?.evidence.some((e) => e.text === "Which color: amber or blue?")).toBe(
				true
			);
		});
		test("new prompt explicitly continues without claiming permission was granted", () => {
			const request = transition(null, event("PermissionRequest"));
			const next = transition(request?.snapshot, event("UserPromptSubmit", { turnId: "turn-2" }));
			expect(next?.attention).toBeNull();
			expect(next?.snapshot.permission?.outcome).toBe("pending");
			expect(next?.snapshot.continuation).toBe("prompt");
			const stop = transition(next?.snapshot, event("Stop", { turnId: "turn-2" }));
			expect(stop?.attention?.kind).toBe("agent-ready");
			expect(stop?.attention?.permission?.outcome).toBe("unconfirmed");
		});
		test("only a matching explicit permission outcome changes pending permission", () => {
			const request = transition(
				null,
				event("PermissionRequest", { permission: { requestId: "p1", outcome: "pending" } })
			);
			const wrong = transition(
				request?.snapshot,
				event("PostToolUse", { permission: { requestId: "p2", outcome: "allowed" } })
			);
			expect(wrong?.attention?.permission?.outcome).toBe("unconfirmed");
			expect(
				transition(
					request?.snapshot,
					event("PostToolUse", { permission: { requestId: "p1", outcome: "allowed" } })
				)?.attention
			).toBeNull();
			const denied = transition(
				request?.snapshot,
				event("Stop", { permission: { requestId: "p1", outcome: "denied" } })
			);
			expect(denied?.attention?.kind).toBe("agent-input");
			expect(denied?.attention?.permission?.outcome).toBe("denied");
		});
		test("legacy replay keeps cleared attention cleared; a genuine later turn still appears", () => {
			const stop = transition(null, event("Stop", { turnId: undefined }));
			expect(stop?.attention?.ordering).toBe("uncertain");
			expect(stop?.attention?.kind).toBe("agent-input");
			const continued = transition(
				stop?.snapshot,
				event("WorkspaceContinuation", { turnId: undefined })
			);
			expect(continued?.attention).toBeNull();
			const replay = transition(
				continued?.snapshot,
				event("Stop", { turnId: undefined, producerTimestamp: 9999 })
			);
			expect(replay?.attention).toBeNull();
			expect(replay?.snapshot.ordering).toBe("uncertain");
			const prompt = transition(
				replay?.snapshot,
				event("UserPromptSubmit", { turnId: "genuine-new-turn" })
			);
			expect(prompt?.attention).toBeNull();
			expect(
				transition(prompt?.snapshot, event("Stop", { turnId: "genuine-new-turn" }))?.attention?.kind
			).toBe("agent-ready");
		});
		test("missing-turn prompt cannot clear newer work", () => {
			const state = transition(null, event("Stop"));
			for (const rawEvent of ["UserPromptSubmit", "PostToolUse", "SessionStart"]) {
				const next = transition(
					state?.snapshot,
					event(rawEvent, { turnId: undefined, producerTimestamp: 99999 })
				);
				expect(next?.snapshot.alert).toBe("task-complete");
				expect(next?.snapshot.turnId).toBe("turn-1");
				expect(next?.attention).not.toBeNull();
			}
		});
	});
test("stable event IDs reject replay and provider timestamps reject older events", () => {
	const prompt = event("UserPromptSubmit", { providerEventId: "e1", providerTimestamp: 10 });
	const state = transition(null, prompt);
	expect(transition(state?.snapshot, { ...prompt, producerTimestamp: 9999 })).toBeNull();
	expect(transition(state?.snapshot, event("Stop", { providerTimestamp: 9 }))).toBeNull();
	expect(
		transition(state?.snapshot, event("Stop", { producerTimestamp: 1, providerTimestamp: 11 }))
			?.attention?.kind
	).toBe("agent-ready");
});
test("view-only resume and compaction preserve attention and fingerprint", () => {
	const stop = transition(
		null,
		event("Stop", {
			evidence: admitAgentEvidence({ last_assistant_message: "Synthetic reply" }, "claude", "Stop"),
		})
	);
	for (const rawEvent of ["SessionStart"])
		expect(
			transition(stop?.snapshot, event(rawEvent, { sessionSource: "resume" }))?.fingerprint
		).toBe(stop?.fingerprint);
});
test("compaction cannot mutate completed work", () => {
	const stop = transition(null, event("Stop"));
	for (const rawEvent of ["PreCompact", "PostCompact"])
		expect(transition(stop?.snapshot, event(rawEvent))).toBeNull();
});
test("same-turn new text changes the exact revision fingerprint", () => {
	const a = transition(
		null,
		event("Stop", {
			evidence: admitAgentEvidence({ last_assistant_message: "First" }, "claude", "Stop"),
		})
	);
	const b = transition(
		a?.snapshot,
		event("Stop", {
			evidence: admitAgentEvidence({ last_assistant_message: "Second" }, "claude", "Stop"),
		})
	);
	expect(a?.fingerprint).not.toBe(b?.fingerprint);
	expect(b?.attention?.summary).toBe("Second");
});

test("uncertain replay cannot invalidate an exact dismissal receipt", () => {
	const stop = transition(null, event("Stop"));
	const replay = transition(
		stop?.snapshot,
		event("Stop", { turnId: undefined, producerTimestamp: 999999 })
	);
	expect(replay?.fingerprint).toBe(stop?.fingerprint);
	expect(replay?.preserveRevision).toBe(true);
	expect(replay?.snapshot.ordering).toBe("uncertain");
});

test("old v2 snapshot format retains its receipt unless new evidence arrives", () => {
	const previous = {
		version: 2,
		alert: "task-complete",
		rawEvent: "Stop",
		turnId: "turn-1",
		retiredTurnIds: [],
		producerTimestamp: 1,
	};
	expect(transition(previous, event("Stop"))?.preserveRevision).toBe(true);
	expect(
		transition(
			previous,
			event("Stop", {
				evidence: admitAgentEvidence(
					{ last_assistant_message: "New actual reply" },
					"claude",
					"Stop"
				),
			})
		)?.preserveRevision
	).toBe(false);
});

test("retained permission plus reply and error remain bounded without dropping either kind", () => {
	const permission = transition(
		null,
		event("PermissionRequest", {
			evidence: admitAgentEvidence(
				{ permission_prompt: "p".repeat(4000), message: "q".repeat(4000) },
				"claude",
				"PermissionRequest"
			),
		})
	);
	const stop = transition(
		permission?.snapshot,
		event("StopFailure", {
			evidence: admitAgentEvidence(
				{ last_assistant_message: "r".repeat(4000), error: "e".repeat(4000) },
				"claude",
				"StopFailure"
			),
		})
	);
	expect(
		stop?.snapshot.evidence?.reduce((total, entry) => total + entry.text.length, 0)
	).toBeLessThanOrEqual(4096);
	expect(stop?.snapshot.evidence?.some((e) => e.sourceField === "last_assistant_message")).toBe(
		true
	);
	expect(stop?.snapshot.evidence?.some((e) => e.kind === "permission")).toBe(true);
	expect(stop?.snapshot.evidence?.some((e) => e.kind === "error")).toBe(true);
});

test("unseen event identity alone cannot order a missing-turn Stop after explicit continuation", () => {
	const stop = transition(null, event("Stop", { turnId: undefined, providerEventId: "old" }));
	const continued = transition(
		stop?.snapshot,
		event("WorkspaceContinuation", { turnId: undefined })
	);
	const unknown = transition(
		continued?.snapshot,
		event("Stop", {
			turnId: undefined,
			providerEventId: "unseen-old-callback",
			producerTimestamp: 99999,
		})
	);
	expect(unknown?.attention).toBeNull();
	expect(unknown?.snapshot.ordering).toBe("uncertain");
	const prompt = transition(
		continued?.snapshot,
		event("UserPromptSubmit", { turnId: undefined, providerEventId: "unseen-old-prompt" })
	);
	expect(prompt?.snapshot.continuation).toBe("reported");
});

test("a distinct permission request replaces stale request text instead of relabeling it", () => {
	const first = transition(
		null,
		event("PermissionRequest", {
			permission: { outcome: "pending", requestId: "p1" },
			evidence: admitAgentEvidence(
				{ permission_prompt: "Old request" },
				"claude",
				"PermissionRequest"
			),
		})
	);
	const second = transition(
		first?.snapshot,
		event("PermissionRequest", {
			permission: { outcome: "pending", requestId: "p2" },
			evidence: admitAgentEvidence(
				{ permission_prompt: "New request" },
				"claude",
				"PermissionRequest"
			),
		})
	);
	expect(second?.attention?.evidence.map((entry) => entry.text)).toEqual(["New request"]);
	const missing = transition(
		first?.snapshot,
		event("PermissionRequest", { permission: { outcome: "pending", requestId: "p3" } })
	);
	expect(missing?.attention?.evidence).toEqual([]);
});

test("failure receipt and error survive generic Stop and compaction until a real continuation", () => {
	const failed = transition(
		null,
		event("StopFailure", {
			evidence: admitAgentEvidence({ error: "Synthetic failure" }, "claude", "StopFailure"),
		})
	);
	const stopped = transition(failed?.snapshot, event("Stop"));
	expect(stopped?.attention?.kind).toBe("agent-input");
	expect(stopped?.attention?.reason.code).toBe("turn-failed");
	expect(stopped?.attention?.evidence[0]?.text).toBe("Synthetic failure");
	expect(stopped?.fingerprint).toBe(failed?.fingerprint);
	expect(stopped?.preserveRevision).toBe(true);
	expect(transition(stopped?.snapshot, event("PostCompact"))).toBeNull();
	const continued = transition(stopped?.snapshot, event("UserPromptSubmit", { turnId: "turn-2" }));
	expect(continued?.attention).toBeNull();
	expect(continued?.snapshot.failure).toBe(false);
	expect(
		transition(continued?.snapshot, event("Stop", { turnId: "turn-2" }))?.attention?.kind
	).toBe("agent-ready");
});

test("unconfirmed permission outcome updates wording without reopening an exact receipt", () => {
	const request = transition(null, event("PermissionRequest"));
	const stop = transition(request?.snapshot, event("Stop"));
	expect(stop?.attention?.permission?.outcome).toBe("unconfirmed");
	expect(stop?.attention?.reason.label).toBe(
		"Permission outcome not confirmed; review the conversation"
	);
	expect(stop?.fingerprint).toBe(request?.fingerprint);
	expect(stop?.preserveRevision).toBe(true);
});
