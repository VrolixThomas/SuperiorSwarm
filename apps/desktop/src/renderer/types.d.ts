import type {
	DialogAPI,
	LspAPI,
	SessionAPI,
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
}

declare global {
	interface Window {
		electron: ElectronAPI;
	}
}
