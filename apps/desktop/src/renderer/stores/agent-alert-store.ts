import { create } from "zustand";
import type { AgentAlert } from "../../shared/agent-events";

interface AgentAlertState {
	alerts: Record<string, AgentAlert>;
	setAlert: (workspaceId: string, alert: AgentAlert) => void;
	clearAlert: (workspaceId: string) => void;
}

export const useAgentAlertStore = create<AgentAlertState>((set) => ({
	alerts: {},
	setAlert: (workspaceId, alert) =>
		set((state) => {
			if (state.alerts[workspaceId] === alert) return state;
			return { alerts: { ...state.alerts, [workspaceId]: alert } };
		}),
	clearAlert: (workspaceId) =>
		set((state) => {
			const { [workspaceId]: _, ...rest } = state.alerts;
			return { alerts: rest };
		}),
}));
