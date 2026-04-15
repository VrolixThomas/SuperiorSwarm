import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { languageServerConfigSchema } from "../../../shared/lsp-schema";
import { LSP_PRESETS } from "../../lsp/presets";
import {
	DEFAULT_SERVER_CONFIGS,
	loadRepoConfig,
	loadUserConfig,
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

	getUserConfig: publicProcedure.query(() => {
		return { servers: loadUserConfig() };
	}),

	getRepoConfig: publicProcedure.input(z.object({ repoPath: z.string() })).query(({ input }) => {
		return { servers: loadRepoConfig(input.repoPath) };
	}),

	saveUserConfig: publicProcedure
		.input(z.object({ servers: z.array(languageServerConfigSchema) }))
		.mutation(({ input }) => {
			saveConfigFile(getUserConfigPath(), input.servers);
			return { ok: true };
		}),

	saveRepoConfig: publicProcedure
		.input(z.object({ repoPath: z.string(), servers: z.array(languageServerConfigSchema) }))
		.mutation(({ input }) => {
			saveConfigFile(getRepoConfigPath(input.repoPath), input.servers);
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
		.mutation(({ input }) => {
			if (input.scope === "repo" && !input.repoPath) {
				throw new Error("repoPath is required when scope is 'repo'");
			}

			const configPath =
				input.scope === "user" ? getUserConfigPath() : getRepoConfigPath(input.repoPath ?? "");

			const existing =
				input.scope === "user" ? loadUserConfig() : loadRepoConfig(input.repoPath ?? "");

			const index = existing.findIndex((s) => s.id === input.id);
			if (index >= 0) {
				const current = existing[index];
				if (current) {
					existing[index] = { ...current, disabled: !input.enabled };
				}
				saveConfigFile(configPath, existing);
				return { ok: true };
			}

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
