import { useCallback, useMemo, useState } from "react";
import { BUILT_IN_SERVER_IDS } from "../../../shared/lsp-builtin-ids";
import type { LanguageServerConfig } from "../../../shared/lsp-schema";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { PageHeading } from "./SectionHeading";
import { LspAddServerFlow } from "./lsp/LspAddServerFlow";
import { LspAdditionalServers } from "./lsp/LspAdditionalServers";
import { LspBuiltInServers } from "./lsp/LspBuiltInServers";
import { LspWorkspaceContext } from "./lsp/LspWorkspaceContext";

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

	// Mutations
	const utils = trpc.useUtils();
	const saveUserConfig = trpc.lsp.saveUserConfig.useMutation({
		onSuccess: () => {
			utils.lsp.getUserConfig.invalidate();
			utils.lsp.getHealth.invalidate();
		},
	});
	const saveRepoConfig = trpc.lsp.saveRepoConfig.useMutation({
		onSuccess: () => {
			utils.lsp.getRepoConfig.invalidate();
			utils.lsp.getHealth.invalidate();
		},
	});
	const setServerEnabled = trpc.lsp.setServerEnabled.useMutation({
		onSuccess: () => {
			utils.lsp.getUserConfig.invalidate();
			utils.lsp.getRepoConfig.invalidate();
			utils.lsp.getHealth.invalidate();
		},
	});

	// UI state
	const [showAddFlow, setShowAddFlow] = useState(false);
	const [editTarget, setEditTarget] = useState<{
		config: LanguageServerConfig;
		scope: "user" | "repo";
	} | null>(null);
	const [toggling, setToggling] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);

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
				result.push({ config: server as LanguageServerConfig, scope: "user" });
			}
		}
		for (const server of repoConfigQuery.data?.servers ?? []) {
			if (!builtInIds.has(server.id) && !server.disabled) {
				result.push({ config: server as LanguageServerConfig, scope: "repo" });
			}
		}
		return result;
	}, [userConfigQuery.data, repoConfigQuery.data, builtInIds]);

	const existingAdditionalIds = useMemo(
		() => new Set(additionalServers.map((s) => s.config.id)),
		[additionalServers]
	);

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

	const handleSaveNew = useCallback(
		async (config: LanguageServerConfig, scope: "user" | "repo") => {
			const existing =
				scope === "user"
					? (userConfigQuery.data?.servers ?? [])
					: (repoConfigQuery.data?.servers ?? []);

			// Upsert: replace if same ID exists, otherwise append
			const index = existing.findIndex((s) => s.id === config.id);
			const updated = [...existing];
			if (index >= 0) {
				updated[index] = config;
			} else {
				updated.push(config);
			}

			if (scope === "user") {
				await saveUserConfig.mutateAsync({ servers: updated });
			} else if (repoPath) {
				await saveRepoConfig.mutateAsync({ repoPath, servers: updated });
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
				healthEntries={healthQuery.data?.entries ?? []}
				disabledIds={disabledIds}
				onToggle={handleToggle}
				toggling={toggling}
			/>

			{showAddFlow || editTarget ? (
				<div className="mb-6 rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
					<LspAddServerFlow
						presets={presetsQuery.data ?? []}
						existingIds={existingAdditionalIds}
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
					healthEntries={healthQuery.data?.entries ?? []}
					onEdit={(config, scope) => setEditTarget({ config, scope })}
					onRemove={handleRemove}
					onAdd={() => setShowAddFlow(true)}
					removing={removing}
				/>
			)}

			<LspWorkspaceContext repoPath={repoPath} />
		</div>
	);
}
