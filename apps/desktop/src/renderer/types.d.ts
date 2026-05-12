import type {
	AgentAlertAPI,
	AgentConfirmAPI,
	AgentDispatchAPI,
	DaemonAPI,
	DialogAPI,
	LspAPI,
	RepoAPI,
	SessionAPI,
	SettingsAPI,
	ShellAPI,
	TerminalAPI,
	TrpcAPI,
} from "../shared/types";

export interface ElectronAPI {
	terminal: TerminalAPI;
	trpc: TrpcAPI;
	dialog: DialogAPI;
	session: SessionAPI;
	shell: ShellAPI;
	lsp: LspAPI;
	daemon: DaemonAPI;
	agentAlert: AgentAlertAPI;
	agentConfirm: AgentConfirmAPI;
	agentDispatch: AgentDispatchAPI;
	settings: SettingsAPI;
	repo: RepoAPI;
}

declare global {
	interface Window {
		electron: ElectronAPI;
	}
}
