export interface TerminalAPI {
	create: (id: string, cwd?: string) => Promise<void>;
	write: (id: string, data: string) => Promise<void>;
	resize: (id: string, cols: number, rows: number) => Promise<void>;
	dispose: (id: string) => Promise<void>;
	onData: (id: string, callback: (data: string) => void) => () => void;
	onExit: (id: string, callback: (exitCode: number) => void) => () => void;
}

export interface TrpcAPI {
	request: (opts: { type: string; path: string; input?: unknown }) => Promise<unknown>;
}

export interface DialogAPI {
	openDirectory: () => Promise<string[] | null>;
}

export interface SessionSaveData {
	sessions: Array<{
		id: string;
		workspaceId: string;
		title: string;
		cwd: string;
		scrollback: string | null;
		sortOrder: number;
	}>;
	state: Record<string, string>;
}

export interface SessionAPI {
	saveSync: (data: SessionSaveData) => { ok: boolean };
}

export interface ShellAPI {
	openExternal: (url: string) => Promise<void>;
}
