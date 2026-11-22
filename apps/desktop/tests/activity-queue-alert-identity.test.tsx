import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { useAgentAlertListener } from "../src/renderer/hooks/useAgentAlertListener";
import { useAgentAlertStore } from "../src/renderer/stores/agent-alert-store";
import { useEditorSettingsStore } from "../src/renderer/stores/editor-settings";
import { useTabStore } from "../src/renderer/stores/tab-store";
import type { AgentEvent } from "../src/shared/agent-events";
const browser = new Window({ url: "http://localhost" });
let listener: ((event: AgentEvent) => void) | undefined;
Object.assign(browser, {
	electron: {
		agentAlert: {
			onAlert: (callback: typeof listener) => {
				listener = callback;
				return () => {
					listener = undefined;
				};
			},
		},
	},
});
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
const { createRoot } = await import("react-dom/client");
function Listener() {
	useAgentAlertListener();
	return null;
}
test("unscoped alerts never attach to the focused workspace", async () => {
	useAgentAlertStore.setState({ alerts: {} });
	useEditorSettingsStore.setState({ notificationSoundsEnabled: false });
	useTabStore.setState({ activeWorkspaceId: "focused" });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(() => root.render(<Listener />));
		await act(() =>
			listener?.({
				alert: "needs-input",
				workspaceId: "",
				agent: "codex",
				sessionId: "terminal",
				cwd: "/source",
				timestamp: 1,
				providerSessionId: "session",
				terminalId: "terminal",
			})
		);
		expect(useAgentAlertStore.getState().alerts).toEqual({});
		await act(() =>
			listener?.({
				alert: "needs-input",
				workspaceId: "source",
				agent: "codex",
				sessionId: "terminal",
				cwd: "/source",
				timestamp: 1,
				providerSessionId: "session",
				terminalId: "terminal",
			})
		);
		expect(useAgentAlertStore.getState().alerts).toEqual({ source: "needs-input" });
	} finally {
		await act(() => root.unmount());
		host.remove();
	}
});
