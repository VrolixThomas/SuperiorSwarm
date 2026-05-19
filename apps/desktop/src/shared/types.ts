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

export interface AgentConfirmRequestPayload {
	id: string;
	kind: "dispatch" | "remove";
	workspaceName: string;
	branch: string | null;
	summary: string;
}

export interface AgentConfirmAPI {
	onRequest: (callback: (payload: AgentConfirmRequestPayload) => void) => () => void;
	reply: (id: string, allow: boolean) => void;
}

export interface AgentDispatchOpenPayload {
	workspaceId: string;
	cwd: string;
	scriptPath: string;
	title: string;
}

export interface AgentDispatchAPI {
	onOpen: (callback: (payload: AgentDispatchOpenPayload) => void) => () => void;
}

export type ThemePref = "system" | "light" | "dark";

export interface SettingsAPI {
	onThemeChanged: (callback: (value: ThemePref) => void) => () => void;
}

export type LspSupportResponse =
	| {
			supported: true;
			serverId: string;
			reason: "language" | "extension";
	  }
	| {
			supported: false;
			reason: "unconfigured" | "missing-binary" | "untrusted-repo";
	  };

export interface LspHealthEntry {
	id: string;
	command: string;
	available: boolean;
	lastError?: string;
	lastStartupError?: string;
	activeSessions?: number;
	activeSessionDocuments?: string[];
	/** Colon-joined PATH entries the probe searched. Informational. */
	searchedPath?: string;
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

export type RepoChangeKind = "working-tree" | "index" | "head" | "refs" | "state";

export interface RepoInvalidateEvent {
	repoPath: string;
	kinds: RepoChangeKind[];
}

export interface RepoAPI {
	subscribe: (repoPath: string) => Promise<void>;
	unsubscribe: (repoPath: string) => Promise<void>;
	onInvalidate: (callback: (event: RepoInvalidateEvent) => void) => () => void;
}

export interface WorkspaceTreeRow {
	id: string;
	projectId: string;
	type: "branch" | "worktree" | "review";
	name: string;
	worktreeId: string | null;
	terminalId: string | null;
	prProvider: string | null;
	prIdentifier: string | null;
	reviewDraftId: string | null;
	createdAt: Date;
	updatedAt: Date;
	worktreePath: string | null;
	draftStatus: string | null;
	draftCommitSha: string | null;
	currentPhase: "idle" | "working" | "blocked" | "done";
	statusText: string | null;
	needs: string | null;
	isOrchestrator: boolean;
	cliPreset: string | null;
	sortOrder: number;
}

/** A workspace row that is guaranteed not to be a "review" type (the service filters these out). */
export type VisibleWorkspaceTreeRow = Omit<WorkspaceTreeRow, "type"> & {
	type: "branch" | "worktree";
};

export interface OrchestratorGroupNode {
	workspace: WorkspaceTreeRow;
	children: VisibleWorkspaceTreeRow[];
}

export interface ProjectWorkspaceTree {
	orchestrators: OrchestratorGroupNode[];
	loose: VisibleWorkspaceTreeRow[];
}

export interface CrossRepoOrchestratorNode {
	id: string;
	name: string;
	colorIndex: number | null;
	status: string;
	repoCount: number;
	memberCount: number;
}

export interface CrossRepoMemberRow {
	workspaceId: string;
	workspaceName: string;
	projectId: string;
	projectName: string;
	sortOrder: number;
}
