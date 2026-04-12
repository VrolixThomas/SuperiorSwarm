import { useEffect, useRef } from "react";
import type { AgentAlert } from "../../shared/agent-events";
import { useAgentAlertStore } from "../stores/agent-alert-store";
import { useEditorSettingsStore } from "../stores/editor-settings";
import { useTabStore } from "../stores/tab-store";

const SOUND_ALERTS: ReadonlySet<AgentAlert> = new Set(["needs-input", "task-complete"]);

export function useAgentAlertListener(): void {
	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		const api = window.electron;
		if (!api?.agentAlert) return;

		const unsub = api.agentAlert.onAlert((event) => {
			const { alert } = event;
			// Use provided workspaceId, or fall back to active workspace
			// (needed for agents like OpenCode whose plugins run in a shared
			// server process without per-terminal context)
			const workspaceId = event.workspaceId || useTabStore.getState().activeWorkspaceId;
			if (!workspaceId) return;

			useAgentAlertStore.getState().setAlert(workspaceId, alert);

			if (
				SOUND_ALERTS.has(alert) &&
				useEditorSettingsStore.getState().notificationSoundsEnabled
			) {
				if (!audioRef.current) {
					audioRef.current = new Audio("/sounds/notify.wav");
				}
				audioRef.current.currentTime = 0;
				audioRef.current.play().catch(() => {});
			}
		});

		return () => {
			unsub();
			audioRef.current?.pause();
			audioRef.current = null;
		};
	}, []);
}
