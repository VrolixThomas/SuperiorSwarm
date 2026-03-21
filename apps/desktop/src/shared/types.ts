export interface TerminalAPI {
	create: (id: string, cwd?: string) => Promise<{ wasAttached: boolean }>;
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
	openFile: (options?: {
		defaultPath?: string;
		filters?: Array<{ name: string; extensions: string[] }>;
	}) => Promise<string | null>;
}

export interface SessionSaveData {
	sessions: Array<{
		id: string;
		workspaceId: string;
		title: string;
		cwd: string;
		// scrollback removed — daemon owns this column
		sortOrder: number;
	}>;
	state: Record<string, string>;
	paneLayouts?: Record<string, string>;
}

export interface SessionAPI {
	saveSync: (data: SessionSaveData) => { ok: boolean };
}

export interface ShellAPI {
	openExternal: (url: string) => Promise<void>;
}

export interface DaemonInspectorData {
	daemonSessions: Array<{ id: string; cwd: string; pid: number }>;
	liveSessions: string[];
	callbackIds: string[];
}

export interface DaemonAPI {
	getStatus: () => Promise<boolean>;
	onStatus: (callback: (connected: boolean) => void) => () => void;
	listSessions: () => Promise<DaemonInspectorData>;
}

export interface LspAPI {
	sendRequest: (opts: {
		languageId: string;
		repoPath: string;
		method: string;
		params: unknown;
	}) => Promise<{ result?: unknown; error?: string }>;
	sendNotification: (opts: {
		languageId: string;
		repoPath: string;
		method: string;
		params: unknown;
	}) => void;
	onNotification: (
		callback: (serverId: string, method: string, params: unknown) => void
	) => () => void;
	onServerRestarted: (
		callback: (configId: string, repoPath: string, uris: string[]) => void
	) => () => void;
}
