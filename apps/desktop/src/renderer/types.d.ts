import type { TerminalAPI } from "../shared/types";

export interface ElectronAPI {
	terminal: TerminalAPI;
}

declare global {
	interface Window {
		electron: ElectronAPI;
	}
}
