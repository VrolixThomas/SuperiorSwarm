import { beforeEach, describe, expect, test } from "bun:test";
import { launchReviewTerminal } from "../src/renderer/lib/review-launch";
import { useReviewModeStore } from "../src/renderer/stores/review-mode-store";

function makeDeps() {
	const attached: Array<{ workspaceId: string; terminalId: string }> = [];
	const written: Array<{ tabId: string; data: string }> = [];
	return {
		attached,
		written,
		deps: {
			attachTerminal: (input: { workspaceId: string; terminalId: string }) => {
				attached.push(input);
			},
			writeTerminal: (tabId: string, data: string) => {
				written.push({ tabId, data });
			},
			newTabId: () => "terminal-test",
			delayMs: 0,
		},
	};
}

describe("launchReviewTerminal", () => {
	beforeEach(() => {
		useReviewModeStore.setState({ terminals: {}, drawerOpen: false });
	});

	test("returns false and does nothing when launchScript is missing", () => {
		const { deps, attached, written } = makeDeps();
		const ok = launchReviewTerminal(
			{ reviewWorkspaceId: "ws-1", worktreePath: "/wt", launchScript: null },
			deps
		);
		expect(ok).toBe(false);
		expect(attached).toHaveLength(0);
		expect(written).toHaveLength(0);
		expect(useReviewModeStore.getState().terminals["ws-1"]).toBeUndefined();
	});

	test("registers terminal, opens drawer, attaches, and writes launch script", async () => {
		const { deps, attached, written } = makeDeps();
		const ok = launchReviewTerminal(
			{ reviewWorkspaceId: "ws-1", worktreePath: "/wt", launchScript: "/tmp/launch.sh" },
			deps
		);
		expect(ok).toBe(true);
		expect(useReviewModeStore.getState().terminals["ws-1"]).toEqual({
			tabId: "terminal-test",
			workspaceId: "ws-1",
			cwd: "/wt",
		});
		expect(useReviewModeStore.getState().drawerOpen).toBe(true);
		expect(attached).toEqual([{ workspaceId: "ws-1", terminalId: "terminal-test" }]);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(written).toEqual([{ tabId: "terminal-test", data: "bash '/tmp/launch.sh'\n" }]);
	});
});
