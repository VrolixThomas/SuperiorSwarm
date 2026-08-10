import { contextBridge, ipcRenderer } from "electron";
import {
	HERMES_ATTACHMENT_IPC_MAX_BYTES,
	HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES,
	HERMES_MAX_ATTACHMENTS,
} from "../shared/hermes";
import type {
	AgentAlertAPI,
	AgentConfirmAPI,
	AgentConfirmRequestPayload,
	AgentDispatchAPI,
	AgentDispatchOpenPayload,
	DaemonAPI,
	DialogAPI,
	HermesAttachmentUploadAPI,
	LspAPI,
	RepoAPI,
	RepoInvalidateEvent,
	SessionAPI,
	SessionSaveData,
	SettingsAPI,
	ShellAPI,
	TerminalAPI,
	TerminalDataMeta,
	TrpcAPI,
} from "../shared/types";

function createDispatcher<T extends unknown[]>(channel: string) {
	const listeners = new Map<string, (...args: T) => void>();
	ipcRenderer.on(channel, (_event: Electron.IpcRendererEvent, id: string, ...args: T) => {
		listeners.get(id)?.(...args);
	});
	return {
		add(id: string, callback: (...args: T) => void): () => void {
			listeners.set(id, callback);
			return () => listeners.delete(id);
		},
	};
}

const dataDispatcher = createDispatcher<[string, TerminalDataMeta | undefined]>("terminal:data");
const exitDispatcher = createDispatcher<[number]>("terminal:exit");

const terminalAPI: TerminalAPI = {
	create: (id: string, cwd?: string, workspaceId?: string) =>
		ipcRenderer.invoke("terminal:create", id, cwd, workspaceId),
	write: (id: string, data: string) => ipcRenderer.invoke("terminal:write", id, data),
	resize: (id: string, cols: number, rows: number) =>
		ipcRenderer.invoke("terminal:resize", id, cols, rows),
	detach: (id: string) => ipcRenderer.invoke("terminal:detach", id),
	dispose: (id: string) => ipcRenderer.invoke("terminal:dispose", id),
	setVisible: (id: string, visible: boolean) =>
		ipcRenderer.invoke("terminal:set-visible", id, visible),
	wake: (id: string) => ipcRenderer.invoke("terminal:wake", id),
	onData: (id: string, callback: (data: string, meta?: TerminalDataMeta) => void) =>
		dataDispatcher.add(id, callback),
	onExit: (id: string, callback: (exitCode: number) => void) => exitDispatcher.add(id, callback),
};

const TRPC_IPC_MAX_INPUT_BYTES = 8 * 1024 * 1024;
const TRPC_IPC_MAX_INPUT_DEPTH = 64;

function assertBoundedTrpcInput(
	value: unknown,
	budget = { remaining: TRPC_IPC_MAX_INPUT_BYTES },
	seen = new WeakSet<object>(),
	depth = 0
): void {
	if (depth > TRPC_IPC_MAX_INPUT_DEPTH) throw new Error("IPC request input is too deeply nested");
	if (typeof value === "string") budget.remaining -= value.length * 2;
	else if (typeof value === "number" || typeof value === "bigint") budget.remaining -= 8;
	else if (typeof value === "boolean") budget.remaining -= 1;
	else if (value === null || value === undefined) return;
	else if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
		throw new Error("Binary data is not allowed in generic IPC requests");
	} else if (typeof value === "object") {
		if (seen.has(value)) throw new Error("Circular IPC request input is not allowed");
		seen.add(value);
		for (const [key, child] of Object.entries(value)) {
			budget.remaining -= key.length * 2;
			assertBoundedTrpcInput(child, budget, seen, depth + 1);
		}
		seen.delete(value);
	} else {
		throw new Error("IPC request input contains an unsupported value");
	}
	if (budget.remaining < 0) throw new Error("IPC request input exceeds 8 MiB");
}

const trpcAPI: TrpcAPI = {
	request: (opts) => {
		try {
			assertBoundedTrpcInput(opts);
		} catch (error) {
			return Promise.reject(error);
		}
		return ipcRenderer.invoke("trpc:request", opts);
	},
};

function validHermesUploadId(value: string): boolean {
	return typeof value === "string" && value.length > 0 && value.length <= 200;
}

const hermesAttachmentsAPI: HermesAttachmentUploadAPI = {
	begin: (attachments) => {
		if (
			!Array.isArray(attachments) ||
			attachments.length < 1 ||
			attachments.length > HERMES_MAX_ATTACHMENTS
		) {
			return Promise.reject(new Error(`Attach between 1 and ${HERMES_MAX_ATTACHMENTS} files`));
		}
		let aggregateBytes = 0;
		for (const attachment of attachments) {
			if (
				typeof attachment.name !== "string" ||
				attachment.name.length < 1 ||
				attachment.name.length > 255 ||
				typeof attachment.mimeType !== "string" ||
				attachment.mimeType.length > 255 ||
				!Number.isSafeInteger(attachment.size) ||
				attachment.size < 0
			) {
				return Promise.reject(new Error("Attachment upload metadata is invalid"));
			}
			aggregateBytes += attachment.size;
			if (aggregateBytes > HERMES_ATTACHMENT_IPC_MAX_BYTES) {
				return Promise.reject(new Error("Attachment uploads must total 64 MiB or smaller"));
			}
		}
		return ipcRenderer.invoke("hermes-attachments:begin", attachments);
	},
	append: (input) => {
		if (!(input.bytes instanceof Uint8Array)) {
			return Promise.reject(new Error("Attachment upload chunk must be a Uint8Array"));
		}
		if (input.bytes.byteLength > HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES) {
			return Promise.reject(new Error("Attachment upload chunk exceeds 256 KiB"));
		}
		if (
			typeof input.uploadId !== "string" ||
			input.uploadId.length > 200 ||
			typeof input.fileId !== "string" ||
			input.fileId.length > 200 ||
			!Number.isSafeInteger(input.offset) ||
			input.offset < 0
		) {
			return Promise.reject(new Error("Attachment upload frame is invalid"));
		}
		return ipcRenderer.invoke("hermes-attachments:append", input);
	},
	finish: (uploadId) =>
		validHermesUploadId(uploadId)
			? ipcRenderer.invoke("hermes-attachments:finish", uploadId)
			: Promise.reject(new Error("Attachment upload handle is invalid")),
	cancel: (uploadId) =>
		validHermesUploadId(uploadId)
			? ipcRenderer.invoke("hermes-attachments:cancel", uploadId)
			: Promise.reject(new Error("Attachment upload handle is invalid")),
};

const dialogAPI: DialogAPI = {
	openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
	openFile: (options) => ipcRenderer.invoke("dialog:openFile", options),
};

const sessionAPI: SessionAPI = {
	saveSync: (data: SessionSaveData) =>
		ipcRenderer.sendSync("terminal-sessions:save-sync", data) as { ok: boolean },
};

const shellAPI: ShellAPI = {
	openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
};

const lspAPI: LspAPI = {
	getSupport: (opts) => ipcRenderer.invoke("lsp:getSupport", opts),
	getHealth: (opts) => ipcRenderer.invoke("lsp:getHealth", opts),
	sendRequest: (opts) => ipcRenderer.invoke("lsp:request", opts),
	sendNotification: (opts) => ipcRenderer.send("lsp:notification", opts),
	onNotification: (callback) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			serverId: string,
			method: string,
			params: unknown
		) => {
			callback(serverId, method, params);
		};
		ipcRenderer.on("lsp:notification-from-server", handler);
		return () => ipcRenderer.removeListener("lsp:notification-from-server", handler);
	},
	onServerRestarted: (callback) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			configId: string,
			repoPath: string,
			uris: string[]
		) => {
			callback(configId, repoPath, uris);
		};
		ipcRenderer.on("lsp:server-restarted", handler);
		return () => ipcRenderer.removeListener("lsp:server-restarted", handler);
	},
};

const daemonAPI: DaemonAPI = {
	getStatus: () => ipcRenderer.invoke("daemon:status"),
	onStatus: (callback: (connected: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, connected: boolean) => callback(connected);
		ipcRenderer.on("daemon:status", listener);
		return () => {
			ipcRenderer.removeListener("daemon:status", listener);
		};
	},
	listSessions: () => ipcRenderer.invoke("daemon:listSessions"),
};

const agentAlertAPI: AgentAlertAPI = {
	onAlert: (callback) => {
		// biome-ignore lint/suspicious/noExplicitAny: IPC bridge receives untyped data from main process
		const handler = (_event: Electron.IpcRendererEvent, event: any) => {
			callback(event);
		};
		ipcRenderer.on("agent:alert", handler);
		return () => {
			ipcRenderer.removeListener("agent:alert", handler);
		};
	},
};

const agentConfirmAPI: AgentConfirmAPI = {
	onRequest: (callback) => {
		const handler = (_event: Electron.IpcRendererEvent, payload: AgentConfirmRequestPayload) =>
			callback(payload);
		ipcRenderer.on("agent-confirm:request", handler);
		return () => {
			ipcRenderer.removeListener("agent-confirm:request", handler);
		};
	},
	reply: (id, allow) => {
		ipcRenderer.send("agent-confirm:reply", { id, allow });
	},
};

const agentDispatchAPI: AgentDispatchAPI = {
	onOpen: (callback) => {
		const handler = (_event: Electron.IpcRendererEvent, payload: AgentDispatchOpenPayload) =>
			callback(payload);
		ipcRenderer.on("agent-dispatch:open", handler);
		return () => {
			ipcRenderer.removeListener("agent-dispatch:open", handler);
		};
	},
};

const settingsAPI: SettingsAPI = {
	onThemeChanged: (callback) => {
		const handler = (_event: Electron.IpcRendererEvent, value: "system" | "light" | "dark") => {
			callback(value);
		};
		ipcRenderer.on("settings:theme-changed", handler);
		return () => {
			ipcRenderer.removeListener("settings:theme-changed", handler);
		};
	},
};

const repoAPI: RepoAPI = {
	subscribe: (repoPath: string) => ipcRenderer.invoke("repo:subscribe", repoPath),
	unsubscribe: (repoPath: string) => ipcRenderer.invoke("repo:unsubscribe", repoPath),
	onInvalidate: (callback) => {
		const handler = (_event: Electron.IpcRendererEvent, payload: RepoInvalidateEvent) => {
			callback(payload);
		};
		ipcRenderer.on("repo:invalidate", handler);
		return () => {
			ipcRenderer.removeListener("repo:invalidate", handler);
		};
	},
};

contextBridge.exposeInMainWorld("electron", {
	terminal: terminalAPI,
	trpc: trpcAPI,
	hermesAttachments: hermesAttachmentsAPI,
	dialog: dialogAPI,
	session: sessionAPI,
	shell: shellAPI,
	lsp: lspAPI,
	daemon: daemonAPI,
	agentAlert: agentAlertAPI,
	agentConfirm: agentConfirmAPI,
	agentDispatch: agentDispatchAPI,
	settings: settingsAPI,
	repo: repoAPI,
});
