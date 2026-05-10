import type {
	AgentAlertAPI,
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
	settings: SettingsAPI;
	repo: RepoAPI;
}

declare global {
	interface Window {
		electron: ElectronAPI;
	}
}
