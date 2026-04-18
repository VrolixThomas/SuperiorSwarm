import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { languageServerConfigSchema } from "../../../shared/lsp-schema";
import { launchInstallAgent } from "../../lsp/agent-install";
import { _clearDetectCache, detectSuggestions } from "../../lsp/detect";
import {
	dismissLanguage,
	getDismissedLanguages,
	undismissLanguage,
} from "../../lsp/dismissed-languages";
import { LSP_PRESETS } from "../../lsp/presets";
import {
	DEFAULT_SERVER_CONFIGS,
	loadRepoConfigCached,
	loadUserConfigCached,
	saveConfigFile,
} from "../../lsp/registry";
import { serverManager } from "../../lsp/server-manager";
import { getRepoTrust, setRepoTrust } from "../../lsp/trust";
import { publicProcedure, router } from "../index";

function getUserConfigPath(): string {
	return join(homedir(), ".config", "superiorswarm", "lsp.json");
}

function getRepoConfigPath(repoPath: string): string {
	return join(repoPath, ".superiorswarm", "lsp.json");
}

export const lspRouter = router({
	getHealth: publicProcedure
		.input(z.object({ repoPath: z.string().optional() }))
		.query(({ input }) => {
			const entries = input.repoPath ? serverManager.getHealth(input.repoPath) : [];
			return { entries };
		}),

	getPresets: publicProcedure.query(() => {
		return LSP_PRESETS;
	}),

	detectSuggestions: publicProcedure
		.input(z.object({ repoPath: z.string().min(1) }))
		.query(({ input }) => {
			const configuredIds = new Set<string>();
			for (const c of loadUserConfigCached()) configuredIds.add(c.id);
			for (const c of loadRepoConfigCached(input.repoPath)) configuredIds.add(c.id);
			return detectSuggestions(input.repoPath, { alreadyConfigured: configuredIds });
		}),

	recheckServer: publicProcedure
		.input(z.object({ id: z.string().min(1), repoPath: z.string().optional() }))
		.mutation(({ input }) => {
			serverManager.clearAvailabilityCache(input.id, input.repoPath);
			return { ok: true };
		}),

	testServer: publicProcedure
		.input(z.object({ id: z.string().min(1), repoPath: z.string().min(1) }))
		.mutation(async ({ input }) => {
			return serverManager.testServer(input.id, input.repoPath);
		}),

	getUserConfig: publicProcedure.query(() => {
		return { servers: loadUserConfigCached() };
	}),

	getRepoConfig: publicProcedure.input(z.object({ repoPath: z.string() })).query(({ input }) => {
		return { servers: loadRepoConfigCached(input.repoPath) };
	}),

	saveUserConfig: publicProcedure
		.input(z.object({ servers: z.array(languageServerConfigSchema) }))
		.mutation(async ({ input }) => {
			const prior = loadUserConfigCached();
			saveConfigFile(getUserConfigPath(), input.servers);
			_clearDetectCache();
			const changed = serverManager.diffChangedIds(prior, input.servers);
			await Promise.all([...changed].map((id) => serverManager.evictServer(id)));
			return { ok: true };
		}),

	saveRepoConfig: publicProcedure
		.input(z.object({ repoPath: z.string(), servers: z.array(languageServerConfigSchema) }))
		.mutation(async ({ input }) => {
			const prior = loadRepoConfigCached(input.repoPath);
			saveConfigFile(getRepoConfigPath(input.repoPath), input.servers);
			_clearDetectCache();
			const changed = serverManager.diffChangedIds(prior, input.servers);
			await Promise.all([...changed].map((id) => serverManager.evictServer(id, input.repoPath)));
			return { ok: true };
		}),

	setServerEnabled: publicProcedure
		.input(
			z.object({
				id: z.string().min(1),
				scope: z.enum(["user", "repo"]),
				enabled: z.boolean(),
				repoPath: z.string().optional(),
			})
		)
		.mutation(async ({ input }) => {
			if (input.scope === "repo" && !input.repoPath) {
				throw new Error("repoPath is required when scope is 'repo'");
			}

			const configPath =
				input.scope === "user" ? getUserConfigPath() : getRepoConfigPath(input.repoPath ?? "");

			const existing =
				input.scope === "user"
					? loadUserConfigCached()
					: loadRepoConfigCached(input.repoPath ?? "");

			const index = existing.findIndex((s) => s.id === input.id);
			if (index >= 0) {
				const current = existing[index];
				if (current) {
					existing[index] = { ...current, disabled: !input.enabled };
				}
				saveConfigFile(configPath, existing);
				_clearDetectCache();
			} else {
				const baseConfig =
					DEFAULT_SERVER_CONFIGS.find((c) => c.id === input.id) ??
					LSP_PRESETS.find((p) => p.id === input.id)?.config;

				if (!baseConfig) {
					throw new Error(
						`Unknown server id "${input.id}". Add the server via saveUserConfig/saveRepoConfig first.`
					);
				}

				existing.push({ ...baseConfig, id: input.id, disabled: !input.enabled });
				saveConfigFile(configPath, existing);
				_clearDetectCache();
			}

			if (input.scope === "repo" && input.repoPath) {
				await serverManager.evictServer(input.id, input.repoPath);
			} else {
				await serverManager.evictServer(input.id);
			}
			return { ok: true };
		}),

	requestInstall: publicProcedure
		.input(z.object({ configId: z.string().min(1), repoPath: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const userConfigs = loadUserConfigCached();
			const repoConfigs = loadRepoConfigCached(input.repoPath);
			const preset = LSP_PRESETS.find((p) => p.id === input.configId);
			const config =
				repoConfigs.find((c) => c.id === input.configId) ??
				userConfigs.find((c) => c.id === input.configId) ??
				DEFAULT_SERVER_CONFIGS.find((c) => c.id === input.configId) ??
				preset?.config;
			if (!config) {
				throw new Error(`Unknown server id "${input.configId}"`);
			}
			const displayName = preset?.displayName ?? input.configId;
			return launchInstallAgent({
				repoPath: input.repoPath,
				configId: input.configId,
				displayName,
				candidateBinaries: [config.command],
			});
		}),

	getDismissedLanguages: publicProcedure.query(() => {
		return getDismissedLanguages();
	}),

	dismissLanguage: publicProcedure
		.input(z.object({ language: z.string().min(1) }))
		.mutation(({ input }) => {
			dismissLanguage(input.language);
			return { ok: true };
		}),

	undismissLanguage: publicProcedure
		.input(z.object({ language: z.string().min(1) }))
		.mutation(({ input }) => {
			undismissLanguage(input.language);
			return { ok: true };
		}),

	getRepoTrust: publicProcedure
		.input(z.object({ repoPath: z.string().min(1) }))
		.query(({ input }) => getRepoTrust(input.repoPath)),

	setRepoTrust: publicProcedure
		.input(z.object({ repoPath: z.string().min(1), trusted: z.boolean() }))
		.mutation(({ input }) => {
			setRepoTrust(input.repoPath, input.trusted);
			return { ok: true };
		}),
});
