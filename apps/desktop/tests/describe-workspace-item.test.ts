import { expect, test } from "bun:test";
import { describeWorkspaceItem } from "../src/main/activity-queue/describe-workspace-item";
import type { ActivityQueueItem, ActivityQueueSource } from "../src/shared/activity-queue";

function describe(sourceType: string, summary: string, rawEvent = "Stop") {
	const item: ActivityQueueItem = {
		id: "source",
		revision: 4,
		acknowledged: false,
		stale: false,
		kind: rawEvent === "Stop" ? "agent-ready" : "agent-input",
		title: "activity-queue",
		summary,
		occurredAt: 1000,
		reasons: [],
		target:
			sourceType === "agent-session"
				? {
						type: "terminal",
						workspaceId: "workspace",
						terminalId: "terminal",
						provider: "codex",
						providerSessionId: "conversation",
					}
				: { type: "workspace", workspaceId: "workspace" },
	};
	const source: ActivityQueueSource = {
		sourceId: "source",
		sourceType,
		snapshot: { rawEvent },
		candidate: item,
		fingerprint: "unchanged",
		observedAt: 1000,
		revision: 4,
		acknowledgedRevision: null,
		error: null,
	};
	return describeWorkspaceItem(item, source, {
		workspaceId: "workspace",
		workspaceName: "activity-queue",
		projectName: "SuperiorSwarm",
		projectTint: 1,
		...(sourceType === "agent-session"
			? { provider: "codex", terminalTitle: "Investigate queue callbacks" }
			: {}),
	});
}

test("a chat turn ending requests review without claiming task completion", () => {
	const item = describe("agent-session", "Ready for next input");
	expect(item.subject).toBe("Investigate queue callbacks");
	expect(item.sourceLabel).toBe("Codex chat");
	expect(item.why).toBe("Review the latest reply");
	expect(item.openLabel).toBe("Open chat to read reply");
	expect(item.evidence).toEqual([]);
	expect(item.missingContext).toContain("does not include the reply or confirm");
	expect(item.nextAction).toContain("after reviewing it");
	expect(item.clearsWhen).toContain("does not send a reply or finish the task");
	expect(item.revision).toBe(4);
	expect(item.target).toMatchObject({ terminalId: "terminal", providerSessionId: "conversation" });
});

test("workspace completion shows the actual report and asks for review", () => {
	const item = describe("agent-workspace", "Fixed the callback mismatch; ready for your review.");
	expect(item.sourceLabel).toBe("Workspace update");
	expect(item.why).toBe("Review completed work");
	expect(item.evidence).toEqual(["Fixed the callback mismatch; ready for your review."]);
	expect(item.missingContext).toBeUndefined();
	expect(item.openLabel).toBe("Open workspace to review");
});

test("an input request or question shows the actual question", () => {
	const item = describe("agent-question", "Which branch should I use?", "question");
	expect(item.subject).toBe("Which branch should I use?");
	expect(item.evidence).toEqual(["Which branch should I use?"]);
	expect(item.why).toBe("Answer the question");
	expect(item.nextAction).toContain("Send an answer to this question");
	const blocked = describe("agent-workspace", "Choose Option A, Option B, or Option C.", "blocked");
	expect(blocked.evidence).toEqual(["Choose Option A, Option B, or Option C."]);
	expect(blocked.openLabel).toBe("Open workspace to respond");
});

test("permission and failure notifications admit when their details are absent", () => {
	const permission = describe("agent-session", "Agent needs input", "PermissionRequest");
	expect(permission.why).toBe("Decide on a permission request");
	expect(permission.evidence).toEqual([]);
	expect(permission.missingContext).toContain("not included");
	expect(permission.openLabel).toBe("Open chat to review permission");
	const failure = describe("agent-session", "Agent turn failed; needs attention", "StopFailure");
	expect(failure.openLabel).toBe("Open chat to inspect error");
	expect(failure.missingContext).toContain("without an error message");
});
