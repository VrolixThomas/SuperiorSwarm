import type { AgentEvent } from "./agent-events";

export interface TerminalAPI {
	create: (id: string, cwd?: string, workspaceId?: string) => Promise<{ wasAttached: boolean }>;
	write: (id: string, data: string) => Promise<void>;
	resize: (id: string, cols: number, rows: number) => Promise<void>;
	detach: (id: string) => Promise<void>;
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

export interface AgentAlertAPI {
	onAlert: (callback: (event: AgentEvent) => void) => () => void;
}

export type LspSupportReason = "language" | "extension" | "unconfigured" | "missing-binary";

export type LspSupportResponse =
	| {
			supported: true;
			serverId: string;
			reason: "language" | "extension";
	  }
	| {
			supported: false;
			reason: "unconfigured" | "missing-binary";
			error?: string;
	  };

export interface LspHealthEntry {
	id: string;
	command: string;
	available: boolean;
	lastError?: string;
	lastStartupError?: string;
	activeSessions?: number;
	activeSessionDocuments?: string[];
	installHint?: string;
}

export interface LspAPI {
	getSupport: (opts: {
		repoPath: string;
		languageId: string;
		filePath: string;
	}) => Promise<LspSupportResponse>;
	getHealth: (opts: { repoPath: string }) => Promise<{ entries: LspHealthEntry[] }>;
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

export interface QuickActionsAPI {
	syncShortcuts: (projectId: string | null) => Promise<void>;
	onTrigger: (
		callback: (data: { command: string; label: string; cwd: string | null }) => void
	) => () => void;
}

export type SidebarSegment = "repos" | "tickets" | "prs";
