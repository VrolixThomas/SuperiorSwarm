import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { LSP_PRESETS } from "../../lsp/presets";
import {
	DEFAULT_SERVER_CONFIGS,
	loadRepoConfig,
	loadUserConfig,
	saveConfigFile,
} from "../../lsp/registry";
import { serverManager } from "../../lsp/server-manager";
import { publicProcedure, router } from "../index";

const serverInputSchema = z.object({
	id: z.string().min(1),
	command: z.string().min(1),
	args: z.array(z.string()).default([]),
	languages: z.array(z.string().min(1)).default([]),
	fileExtensions: z.array(z.string().min(1)).default([]),
	installHint: z.string().min(1).optional(),
	rootMarkers: z.array(z.string().min(1)).default([".git"]),
	initializationOptions: z.record(z.string(), z.unknown()).optional(),
	disabled: z.boolean().default(false),
});

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

	getRepoConfig: publicProcedure
		.input(z.object({ repoPath: z.string() }))
		.query(({ input }) => {
			return { servers: loadRepoConfig(input.repoPath) };
		}),

	saveUserConfig: publicProcedure
		.input(z.object({ servers: z.array(serverInputSchema) }))
		.mutation(({ input }) => {
			saveConfigFile(getUserConfigPath(), input.servers);
			return { ok: true };
		}),

	saveRepoConfig: publicProcedure
		.input(z.object({ repoPath: z.string(), servers: z.array(serverInputSchema) }))
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
				input.scope === "user"
					? getUserConfigPath()
					: getRepoConfigPath(input.repoPath ?? "");

			const existing =
				input.scope === "user" ? loadUserConfig() : loadRepoConfig(input.repoPath ?? "");

			const index = existing.findIndex((s) => s.id === input.id);
			if (index >= 0) {
				existing[index] = { ...existing[index], disabled: !input.enabled };
			} else {
				// Look up defaults or presets for the full config
				const defaultConfig = DEFAULT_SERVER_CONFIGS.find((c) => c.id === input.id);
				const presetConfig = LSP_PRESETS.find((p) => p.id === input.id)?.config;
				const baseConfig = defaultConfig ?? presetConfig;

				existing.push({
					id: input.id,
					command: baseConfig?.command ?? input.id,
					args: baseConfig?.args ?? [],
					languages: baseConfig?.languages ?? [],
					fileExtensions: baseConfig?.fileExtensions ?? [],
					rootMarkers: baseConfig?.rootMarkers ?? [".git"],
					disabled: !input.enabled,
				});
			}

			saveConfigFile(configPath, existing);
			return { ok: true };
		}),
});
