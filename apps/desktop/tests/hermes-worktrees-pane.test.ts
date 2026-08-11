import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// @ts-expect-error The tests project omits JSX; the renderer project type-checks this TSX module.
import {
	HermesSessionTabStrip,
	HermesWorktreesPane,
	groupHermesWorktrees,
	nextHermesSessionPane,
	openHermesLinkedWorktree,
	resolveHermesWorkspaceSessionId,
} from "../src/renderer/components/hermes/HermesWorktreesPane";
import type { HermesLinkedWorkspace } from "../src/shared/hermes";

function link(overrides: Partial<HermesLinkedWorkspace> = {}): HermesLinkedWorkspace {
	return {
		id: "link-1",
		connectionId: "connection-1",
		profileId: "work",
		hermesSessionId: "session-1",
		hermesLineageRootId: null,
		workspaceId: "workspace-1",
		source: "tool-artifact",
		linkedAt: 1,
		missing: false,
		projectId: "project-1",
		projectName: "App",
		workspaceName: "feat/one",
		branch: "feat/one",
		worktreePath: "/repos/app-worktrees/feat-one",
		currentPhase: "working",
		statusText: "Implementing the fix",
		needs: null,
		statusUpdatedAt: 2,
		hasTerminal: false,
		...overrides,
	};
}

describe("Hermes Worktrees pane", () => {
	test("keeps links on the selected lineage root instead of the rotating history tip", () => {
		expect(
			resolveHermesWorkspaceSessionId("session-root", {
				durableSessionId: "session-tip",
				view: "durable",
				messages: [],
			})
		).toBe("session-root");
		expect(resolveHermesWorkspaceSessionId("session-tip", undefined)).toBe("session-tip");
		expect(
			resolveHermesWorkspaceSessionId(null, {
				durableSessionId: "legacy-session",
				view: "active",
				messages: [],
			})
		).toBe("legacy-session");
	});

	test("renders an accessible Chat-first tab strip with Worktrees immediately to its right", () => {
		const html = renderToStaticMarkup(
			createElement(HermesSessionTabStrip, {
				activePane: "chat",
				worktreeCount: 3,
				onSelect: () => {},
			})
		);

		expect(html).toContain('role="tablist"');
		expect(html).toMatch(/>Chat<.*>Worktrees</s);
		expect(html).toContain('id="hermes-chat-tab"');
		expect(html).toContain('aria-selected="true"');
		expect(html).toContain('aria-controls="hermes-chat-panel"');
		expect(html).toContain('aria-controls="hermes-worktrees-panel"');
		expect(html).toMatch(/id="hermes-chat-tab"[^>]*tabindex="0"/);
		expect(html).toMatch(/id="hermes-worktrees-tab"[^>]*tabindex="-1"/);
		expect(html).toContain("3");
	});

	test("supports wrapped arrow and boundary-key tab selection", () => {
		expect(nextHermesSessionPane("chat", "ArrowRight")).toBe("worktrees");
		expect(nextHermesSessionPane("worktrees", "ArrowRight")).toBe("chat");
		expect(nextHermesSessionPane("chat", "ArrowLeft")).toBe("worktrees");
		expect(nextHermesSessionPane("worktrees", "ArrowLeft")).toBe("chat");
		expect(nextHermesSessionPane("worktrees", "Home")).toBe("chat");
		expect(nextHermesSessionPane("chat", "End")).toBe("worktrees");
		expect(nextHermesSessionPane("chat", "Enter")).toBeNull();
	});

	test("groups every linked worktree by repository", () => {
		const groups = groupHermesWorktrees([
			link(),
			link({ id: "link-2", workspaceId: "workspace-2", branch: "feat/two" }),
			link({
				id: "link-3",
				workspaceId: "workspace-3",
				projectId: "project-2",
				projectName: "API",
				branch: "fix/api",
			}),
		]);

		expect(
			groups.map((group: { projectName: string; worktrees: unknown[] }) => [
				group.projectName,
				group.worktrees.length,
			])
		).toEqual([
			["API", 1],
			["App", 2],
		]);
	});

	test("explains the empty state without asking for a preselected repository", () => {
		const html = renderToStaticMarkup(
			createElement(HermesWorktreesPane, {
				links: [],
				availableWorktrees: [],
				recoveryWorktreeId: "",
				recoveryPending: false,
				onOpen: () => {},
				onRecoveryChange: () => {},
				onRecoveryLink: () => {},
				onRecoveryUnlink: () => {},
			})
		);

		expect(html).toContain("Hermes will add worktrees here when repository changes are needed.");
		expect(html).not.toContain("Select a repository");
		expect(html).not.toContain("No workspace");
	});

	test("shows phase, status, needs, and a disabled missing/deleted state", () => {
		const html = renderToStaticMarkup(
			createElement(HermesWorktreesPane, {
				links: [
					link({ currentPhase: "blocked", statusText: "Waiting for CI", needs: "CI token" }),
					link({
						id: "link-missing",
						workspaceId: "workspace-missing",
						missing: true,
						projectId: null,
						projectName: null,
						workspaceName: null,
						branch: null,
						worktreePath: null,
						currentPhase: null,
						statusText: null,
						needs: null,
						statusUpdatedAt: null,
					}),
				],
				availableWorktrees: [],
				recoveryWorktreeId: "",
				recoveryPending: false,
				onOpen: () => {},
				onRecoveryChange: () => {},
				onRecoveryLink: () => {},
				onRecoveryUnlink: () => {},
			})
		);

		expect(html).toContain("blocked");
		expect(html).toContain("Waiting for CI");
		expect(html).toContain("Needs:");
		expect(html).toContain("CI token");
		expect(html).toContain("Missing or deleted");
		expect(html).toMatch(/workspace-missing[\s\S]*disabled/);
		const card = html.match(/<button[^>]*data-worktree-id="workspace-1"[\s\S]*?<\/button>/)?.[0];
		expect(card).toBeDefined();
		expect(card).not.toContain("<div");
		expect(card).not.toContain('aria-label="Open worktree');
		expect(card).toContain("aria-describedby=");
		expect(card).toContain("Branch:");
		expect(card).toContain("Phase:");
		expect(card).toContain("Status:");
		expect(card).toContain("Needs:");
	});

	test("opens the exact worktree and preserves established terminal attachment behavior", () => {
		const calls: unknown[] = [];
		const opened = openHermesLinkedWorktree(
			link(),
			{ connectionId: "connection-1", sessionId: "session-1" },
			{
				openWorkspaceFromHermes: (...args: unknown[]) => calls.push(["open", ...args]),
				getTabsByWorkspace: () => [],
				addTerminalTab: (...args: unknown[]) => {
					calls.push(["terminal", ...args]);
					return "terminal-1";
				},
				attachTerminal: (...args: unknown[]) => calls.push(["attach", ...args]),
			}
		);

		expect(opened).toBe(true);
		expect(calls).toEqual([
			[
				"open",
				"workspace-1",
				"/repos/app-worktrees/feat-one",
				{ connectionId: "connection-1", profileId: "work", sessionId: "session-1" },
				"worktrees",
			],
			["terminal", "workspace-1", "/repos/app-worktrees/feat-one", "feat/one"],
			["attach", "workspace-1", "terminal-1"],
		]);
	});

	test("navigates without replacing a persisted terminal that is not in renderer tabs", () => {
		const calls: unknown[] = [];

		const opened = openHermesLinkedWorktree(
			link({ hasTerminal: true }),
			{ connectionId: "connection-1", sessionId: "session-1" },
			{
				openWorkspaceFromHermes: (...args: unknown[]) => calls.push(["open", ...args]),
				getTabsByWorkspace: () => [],
				addTerminalTab: (...args: unknown[]) => {
					calls.push(["terminal", ...args]);
					return "terminal-new";
				},
				attachTerminal: (...args: unknown[]) => calls.push(["attach", ...args]),
			}
		);

		expect(opened).toBe(true);
		expect(calls).toEqual([
			[
				"open",
				"workspace-1",
				"/repos/app-worktrees/feat-one",
				{ connectionId: "connection-1", profileId: "work", sessionId: "session-1" },
				"worktrees",
			],
		]);
	});

	test("does not duplicate an existing renderer terminal", () => {
		const calls: unknown[] = [];

		openHermesLinkedWorktree(
			link(),
			{ connectionId: "connection-1", sessionId: "session-1" },
			{
				openWorkspaceFromHermes: (...args: unknown[]) => calls.push(["open", ...args]),
				getTabsByWorkspace: () => [{ kind: "terminal" }],
				addTerminalTab: (...args: unknown[]) => {
					calls.push(["terminal", ...args]);
					return "terminal-new";
				},
				attachTerminal: (...args: unknown[]) => calls.push(["attach", ...args]),
			}
		);

		expect(calls.map((call) => (call as unknown[])[0])).toEqual(["open"]);
	});
});
