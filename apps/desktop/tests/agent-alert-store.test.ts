import { beforeEach, describe, expect, test } from "bun:test";
import { useAgentAlertStore } from "../src/renderer/stores/agent-alert-store";

describe("AgentAlertStore", () => {
	beforeEach(() => {
		useAgentAlertStore.setState({ alerts: {} });
	});

	test("setAlert stores alert for workspace", () => {
		useAgentAlertStore.getState().setAlert("ws-1", "active");
		expect(useAgentAlertStore.getState().alerts["ws-1"]).toBe("active");
	});

	test("setAlert overwrites previous alert", () => {
		const store = useAgentAlertStore.getState();
		store.setAlert("ws-1", "active");
		store.setAlert("ws-1", "needs-input");
		expect(useAgentAlertStore.getState().alerts["ws-1"]).toBe("needs-input");
	});

	test("clearAlert removes workspace entry", () => {
		const store = useAgentAlertStore.getState();
		store.setAlert("ws-1", "task-complete");
		store.clearAlert("ws-1");
		expect(useAgentAlertStore.getState().alerts["ws-1"]).toBeUndefined();
	});

	test("clearAlert is no-op for unknown workspace", () => {
		useAgentAlertStore.getState().clearAlert("nonexistent");
		expect(Object.keys(useAgentAlertStore.getState().alerts)).toHaveLength(0);
	});

	test("multiple workspaces tracked independently", () => {
		const store = useAgentAlertStore.getState();
		store.setAlert("ws-1", "active");
		store.setAlert("ws-2", "needs-input");
		store.clearAlert("ws-1");
		expect(useAgentAlertStore.getState().alerts["ws-1"]).toBeUndefined();
		expect(useAgentAlertStore.getState().alerts["ws-2"]).toBe("needs-input");
	});

	test("setAlert is a no-op when value unchanged", () => {
		const store = useAgentAlertStore.getState();
		store.setAlert("ws-1", "active");
		const alertsBefore = useAgentAlertStore.getState().alerts;
		store.setAlert("ws-1", "active");
		const alertsAfter = useAgentAlertStore.getState().alerts;
		expect(alertsBefore).toBe(alertsAfter); // Same reference — no new object
	});
});
