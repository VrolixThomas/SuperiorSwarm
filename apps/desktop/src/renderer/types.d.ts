import type { DialogAPI, SessionAPI, TerminalAPI, TrpcAPI } from "../shared/types";

export interface ElectronAPI {
	terminal: TerminalAPI;
	trpc: TrpcAPI;
	dialog: DialogAPI;
	session: SessionAPI;
}

declare global {
	interface Window {
		electron: ElectronAPI;
	}
}
