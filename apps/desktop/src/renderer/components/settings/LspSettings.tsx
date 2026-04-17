import { useCallback, useEffect, useMemo, useState } from "react";
import { BUILT_IN_SERVER_IDS } from "../../../shared/lsp-builtin-ids";
import type {
	LanguageServerConfig,
	LspDetectSuggestion,
	LspPreset,
} from "../../../shared/lsp-schema";
import { formatServerListIssues } from "../../../shared/lsp-zod-errors";
import type { LspHealthEntry } from "../../../shared/types";
import { useProjectStore } from "../../stores/projects";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { PageHeading } from "./SectionHeading";
import { LspAddServerFlow } from "./lsp/LspAddServerFlow";
import { LspAdditionalServers } from "./lsp/LspAdditionalServers";
import { LspBuiltInServers } from "./lsp/LspBuiltInServers";
import { LspWorkspaceContext } from "./lsp/LspWorkspaceContext";
import { detectConflicts } from "./lsp/conflicts";
import { ConfigFieldErrors } from "./lsp/lsp-errors";

const EMPTY_HEALTH_ENTRIES: LspHealthEntry[] = [];
const EMPTY_PRESETS: LspPreset[] = [];
const EMPTY_SUGGESTIONS: LspDetectSuggestion[] = [];

interface TrpcLikeError {
	data?: { zodIssues?: unknown };
}

function extractFieldErrors(err: unknown, serverIndex: number): Record<string, string> | null {
	const e = err as TrpcLikeError;
	const issues = e?.data?.zodIssues;
	if (!Array.isArray(issues)) return null;
	const formatted = formatServerListIssues(issues as Parameters<typeof formatServerListIssues>[0]);
	const map: Record<string, string> = {};
	for (const { serverIndex: idx, field, message } of formatted) {
		if (idx !== serverIndex) continue;
		if (!map[field]) map[field] = message;
	}
	return Object.keys(map).length > 0 ? map : null;
}

export function LspSettings() {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const workspaceQuery = trpc.workspaces.getById.useQuery(
		{ id: activeWorkspaceId ?? "" },
		{ enabled: activeWorkspaceId != null }
	);

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: workspaceQuery.data?.projectId ?? "" },
		{ enabled: !!workspaceQuery.data?.projectId }
	);

	const repoPath = projectQuery.data?.repoPath ?? null;

	// Queries
	const healthQuery = trpc.lsp.getHealth.useQuery(
		{ repoPath: repoPath ?? undefined },
		{ enabled: true }
	);
	const presetsQuery = trpc.lsp.getPresets.useQuery();
	const userConfigQuery = trpc.lsp.getUserConfig.useQuery();
	const repoConfigQuery = trpc.lsp.getRepoConfig.useQuery(
		{ repoPath: repoPath ?? "" },
		{ enabled: !!repoPath }
	);
	const suggestionsQuery = trpc.lsp.detectSuggestions.useQuery(
		{ repoPath: repoPath ?? "" },
		{ enabled: !!repoPath }
	);

	// Mutations
	const utils = trpc.useUtils();
	const saveUserConfig = trpc.lsp.saveUserConfig.useMutation({
		onSuccess: () => {
			utils.lsp.getUserConfig.invalidate();
			utils.lsp.getHealth.invalidate();
			utils.lsp.detectSuggestions.invalidate();
		},
	});
	const saveRepoConfig = trpc.lsp.saveRepoConfig.useMutation({
		onSuccess: () => {
			utils.lsp.getRepoConfig.invalidate();
			utils.lsp.getHealth.invalidate();
			utils.lsp.detectSuggestions.invalidate();
		},
	});
	const setServerEnabled = trpc.lsp.setServerEnabled.useMutation({
		onSuccess: () => {
			utils.lsp.getUserConfig.invalidate();
			utils.lsp.getRepoConfig.invalidate();
			utils.lsp.getHealth.invalidate();
		},
	});
	const recheckServer = trpc.lsp.recheckServer.useMutation({
		onSuccess: () => {
			utils.lsp.getHealth.invalidate();
		},
	});
	const testServer = trpc.lsp.testServer.useMutation();
	const requestInstall = trpc.lsp.requestInstall.useMutation();

	// UI state
	const [showAddFlow, setShowAddFlow] = useState(false);
	const [editTarget, setEditTarget] = useState<{
		config: LanguageServerConfig;
		scope: "user" | "repo";
	} | null>(null);
	const [toggling, setToggling] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	const rechecking = recheckServer.isPending ? (recheckServer.variables?.id ?? null) : null;
	const askingAgent = requestInstall.isPending
		? (requestInstall.variables?.configId ?? null)
		: null;

	// Re-check availability on window focus — users commonly install a
	// binary in a terminal then come back to the app expecting it to light up.
	useEffect(() => {
		const onFocus = () => {
			utils.lsp.getHealth.invalidate();
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [utils.lsp.getHealth]);

	// Derived: disabled built-in IDs from user config
	const disabledIds = useMemo(() => {
		const ids = new Set<string>();
		for (const server of userConfigQuery.data?.servers ?? []) {
			if (server.disabled) ids.add(server.id);
		}
		for (const server of repoConfigQuery.data?.servers ?? []) {
			if (server.disabled) ids.add(server.id);
		}
		return ids;
	}, [userConfigQuery.data, repoConfigQuery.data]);

	// Derived: additional (non-built-in) servers
	const builtInIds = useMemo(() => new Set(BUILT_IN_SERVER_IDS), []);

	const additionalServers = useMemo(() => {
		const result: Array<{ config: LanguageServerConfig; scope: "user" | "repo" }> = [];
		for (const server of userConfigQuery.data?.servers ?? []) {
			if (!builtInIds.has(server.id) && !server.disabled) {
				result.push({ config: server, scope: "user" });
			}
		}
		for (const server of repoConfigQuery.data?.servers ?? []) {
			if (!builtInIds.has(server.id) && !server.disabled) {
				result.push({ config: server, scope: "repo" });
			}
		}
		return result;
	}, [userConfigQuery.data, repoConfigQuery.data, builtInIds]);

	const existingAdditionalIds = useMemo(
		() => new Set(additionalServers.map((s) => s.config.id)),
		[additionalServers]
	);

	const conflicts = useMemo(() => {
		const ordered: LanguageServerConfig[] = [];
		for (const s of userConfigQuery.data?.servers ?? []) ordered.push(s);
		for (const s of repoConfigQuery.data?.servers ?? []) ordered.push(s);
		return detectConflicts(ordered);
	}, [userConfigQuery.data, repoConfigQuery.data]);

	// Handlers
	const handleToggle = useCallback(
		async (id: string, currentlyDisabled: boolean) => {
			setToggling(id);
			try {
				await setServerEnabled.mutateAsync({
					id,
					scope: "user",
					enabled: currentlyDisabled, // re-enable if currently disabled
				});
			} finally {
				setToggling(null);
			}
		},
		[setServerEnabled]
	);

	const handleRemove = useCallback(
		async (id: string, scope: "user" | "repo") => {
			setRemoving(id);
			try {
				const config =
					scope === "user" ? userConfigQuery.data?.servers : repoConfigQuery.data?.servers;
				const filtered = (config ?? []).filter((s) => s.id !== id);
				if (scope === "user") {
					await saveUserConfig.mutateAsync({ servers: filtered });
				} else if (repoPath) {
					await saveRepoConfig.mutateAsync({ repoPath, servers: filtered });
				}
			} finally {
				setRemoving(null);
			}
		},
		[userConfigQuery.data, repoConfigQuery.data, saveUserConfig, saveRepoConfig, repoPath]
	);

	const handleTest = useCallback(
		async (id: string) => {
			if (!repoPath) return { ok: false as const, error: "Open a project to test a server" };
			return testServer.mutateAsync({ id, repoPath });
		},
		[testServer, repoPath]
	);

	const handleMove = useCallback(
		async (id: string, scope: "user" | "repo", direction: "up" | "down") => {
			const source =
				scope === "user" ? userConfigQuery.data?.servers : repoConfigQuery.data?.servers;
			if (!source) return;
			const index = source.findIndex((s) => s.id === id);
			if (index < 0) return;
			const swapIndex = direction === "up" ? index - 1 : index + 1;
			if (swapIndex < 0 || swapIndex >= source.length) return;

			const updated = [...source];
			const tmp = updated[index];
			const other = updated[swapIndex];
			if (!tmp || !other) return;
			updated[index] = other;
			updated[swapIndex] = tmp;

			if (scope === "user") {
				await saveUserConfig.mutateAsync({ servers: updated });
			} else if (repoPath) {
				await saveRepoConfig.mutateAsync({ repoPath, servers: updated });
			}
		},
		[userConfigQuery.data, repoConfigQuery.data, saveUserConfig, saveRepoConfig, repoPath]
	);

	const handleAskAgent = useCallback(
		async (id: string) => {
			if (!repoPath) return;
			try {
				const install = await requestInstall.mutateAsync({
					configId: id,
					repoPath,
				});
				const store = useTabStore.getState();
				if (!store.activeWorkspaceId) return;
				const tabId = store.addTerminalTab(store.activeWorkspaceId, repoPath, `Install ${id}`);
				store.setActiveTab(tabId);
				await window.electron.terminal.create(tabId, repoPath, store.activeWorkspaceId);
				const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
				await window.electron.terminal.write(
					tabId,
					`bash ${q(install.launchScript)} ${q(install.repoPath)} ${q(install.promptFilePath)}\r`
				);
				useProjectStore.getState().closeSettings();
			} catch (err) {
				console.error("[lsp] ask-agent install failed:", err);
			}
		},
		[repoPath, requestInstall]
	);

	const handleRecheck = useCallback(
		async (id: string) => {
			await recheckServer.mutateAsync({ id, repoPath: repoPath ?? undefined });
		},
		[recheckServer, repoPath]
	);

	const handleSaveNew = useCallback(
		async (config: LanguageServerConfig, scope: "user" | "repo") => {
			const existing =
				scope === "user"
					? (userConfigQuery.data?.servers ?? [])
					: (repoConfigQuery.data?.servers ?? []);

			// Upsert: replace if same ID exists, otherwise append
			const index = existing.findIndex((s) => s.id === config.id);
			const updated = [...existing];
			const targetIndex = index >= 0 ? index : updated.length;
			if (index >= 0) {
				updated[index] = config;
			} else {
				updated.push(config);
			}

			try {
				if (scope === "user") {
					await saveUserConfig.mutateAsync({ servers: updated });
				} else if (repoPath) {
					await saveRepoConfig.mutateAsync({ repoPath, servers: updated });
				}
			} catch (err) {
				const fieldMap = extractFieldErrors(err, targetIndex);
				if (fieldMap) throw new ConfigFieldErrors(fieldMap);
				throw err;
			}

			setShowAddFlow(false);
			setEditTarget(null);
		},
		[userConfigQuery.data, repoConfigQuery.data, saveUserConfig, saveRepoConfig, repoPath]
	);

	return (
		<div>
			<PageHeading
				title="Language Servers"
				subtitle="Configure language servers for code intelligence — completions, hover, go-to-definition, and diagnostics"
			/>

			<LspBuiltInServers
				healthEntries={healthQuery.data?.entries ?? EMPTY_HEALTH_ENTRIES}
				disabledIds={disabledIds}
				onToggle={handleToggle}
				toggling={toggling}
				onRecheck={handleRecheck}
				onAskAgent={repoPath ? handleAskAgent : undefined}
				onTest={repoPath ? handleTest : undefined}
				rechecking={rechecking}
				askingAgent={askingAgent}
			/>

			{showAddFlow || editTarget ? (
				<div className="mb-6 rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
					<LspAddServerFlow
						presets={presetsQuery.data ?? EMPTY_PRESETS}
						existingIds={existingAdditionalIds}
						builtInIds={builtInIds}
						suggestions={suggestionsQuery.data ?? EMPTY_SUGGESTIONS}
						repoPath={repoPath}
						onSave={handleSaveNew}
						onCancel={() => {
							setShowAddFlow(false);
							setEditTarget(null);
						}}
						editTarget={editTarget}
					/>
				</div>
			) : (
				<LspAdditionalServers
					servers={additionalServers}
					healthEntries={healthQuery.data?.entries ?? EMPTY_HEALTH_ENTRIES}
					onEdit={(config, scope) => setEditTarget({ config, scope })}
					onRemove={handleRemove}
					onAdd={() => setShowAddFlow(true)}
					removing={removing}
					onRecheck={handleRecheck}
					onAskAgent={repoPath ? handleAskAgent : undefined}
					onTest={repoPath ? handleTest : undefined}
					rechecking={rechecking}
					askingAgent={askingAgent}
					conflicts={conflicts}
					onMove={handleMove}
				/>
			)}

			<LspWorkspaceContext repoPath={repoPath} />
		</div>
	);
}
