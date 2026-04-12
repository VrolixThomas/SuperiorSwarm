import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const serverSchema = z.object({
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

const configFileSchema = z.object({
	servers: z.array(z.unknown()).default([]),
});

export type LanguageServerConfig = z.infer<typeof serverSchema>;

export interface LanguageRegistry {
	byId: Map<string, LanguageServerConfig>;
	byLanguageId: Map<string, LanguageServerConfig[]>;
	byExtension: Map<string, LanguageServerConfig[]>;
}

export type SupportResolution =
	| {
			supported: true;
			config: LanguageServerConfig;
			reason: "language" | "extension";
	  }
	| {
			supported: false;
			reason: "unconfigured";
	  };

export const DEFAULT_SERVER_CONFIGS: LanguageServerConfig[] = [
	{
		id: "typescript",
		command: "typescript-language-server",
		args: ["--stdio"],
		languages: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
		fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		rootMarkers: ["package.json", "tsconfig.json", ".git"],
		disabled: false,
	},
	{
		id: "python",
		command: "pyright-langserver",
		args: ["--stdio"],
		languages: ["python"],
		fileExtensions: [".py"],
		rootMarkers: ["pyproject.toml", "setup.py", ".git"],
		disabled: false,
	},
	{
		id: "go",
		command: "gopls",
		args: [],
		languages: ["go"],
		fileExtensions: [".go"],
		rootMarkers: ["go.mod", ".git"],
		disabled: false,
	},
	{
		id: "rust",
		command: "rust-analyzer",
		args: [],
		languages: ["rust"],
		fileExtensions: [".rs"],
		rootMarkers: ["Cargo.toml", ".git"],
		disabled: false,
	},
	{
		id: "java",
		command: "jdtls",
		args: [],
		languages: ["java"],
		fileExtensions: [".java"],
		rootMarkers: ["pom.xml", "build.gradle", ".git"],
		disabled: false,
	},
	{
		id: "cpp",
		command: "clangd",
		args: [],
		languages: ["cpp", "c"],
		fileExtensions: [".cc", ".cpp", ".c", ".h", ".hpp"],
		rootMarkers: ["compile_commands.json", ".git"],
		disabled: false,
	},
	{
		id: "php",
		command: "intelephense",
		args: ["--stdio"],
		languages: ["php"],
		fileExtensions: [".php"],
		rootMarkers: ["composer.json", ".git"],
		disabled: false,
	},
	{
		id: "ruby",
		command: "solargraph",
		args: ["stdio"],
		languages: ["ruby"],
		fileExtensions: [".rb"],
		rootMarkers: ["Gemfile", ".git"],
		disabled: false,
	},
];

export function buildRegistry(input: {
	defaults: LanguageServerConfig[];
	user: LanguageServerConfig[];
	repo: LanguageServerConfig[];
	env: Record<string, string | undefined>;
}): LanguageRegistry {
	const merged = new Map<string, LanguageServerConfig>();

	for (const source of [input.defaults, input.user, input.repo]) {
		for (const candidate of source) {
			const parsed = serverSchema.safeParse(candidate);
			if (!parsed.success) {
				continue;
			}

			const config = parsed.data;
			merged.set(config.id, {
				...config,
				command: interpolate(config.command, input.env),
				args: config.args.map((arg) => interpolate(arg, input.env)),
			});
		}
	}

	const byLanguageId = new Map<string, LanguageServerConfig[]>();
	const byExtension = new Map<string, LanguageServerConfig[]>();

	for (const config of merged.values()) {
		if (config.disabled) {
			continue;
		}

		for (const languageId of config.languages) {
			const existing = byLanguageId.get(languageId) ?? [];
			existing.push(config);
			byLanguageId.set(languageId, existing);
		}

		for (const ext of config.fileExtensions) {
			const normalized = normalizeExtension(ext);
			if (!normalized) {
				continue;
			}
			const existing = byExtension.get(normalized) ?? [];
			existing.push(config);
			byExtension.set(normalized, existing);
		}
	}

	return {
		byId: merged,
		byLanguageId,
		byExtension,
	};
}

export function resolveSupport(
	registry: LanguageRegistry,
	input: { languageId: string; filePath: string }
): SupportResolution {
	const byLanguageId = registry.byLanguageId.get(input.languageId)?.[0];
	if (byLanguageId) {
		return {
			supported: true,
			config: byLanguageId,
			reason: "language",
		};
	}

	const extension = getFileExtension(input.filePath);
	if (extension) {
		const byExtension = registry.byExtension.get(extension)?.[0];
		if (byExtension) {
			return {
				supported: true,
				config: byExtension,
				reason: "extension",
			};
		}
	}

	return {
		supported: false,
		reason: "unconfigured",
	};
}

export function loadUserConfig(): LanguageServerConfig[] {
	const path = join(homedir(), ".config", "superiorswarm", "lsp.json");
	return loadConfigFile(path);
}

export function loadRepoConfig(repoPath: string): LanguageServerConfig[] {
	return loadConfigFile(join(repoPath, ".superiorswarm", "lsp.json"));
}

function loadConfigFile(path: string): LanguageServerConfig[] {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return [];
	}

	const parsed = configFileSchema.safeParse(raw);
	if (!parsed.success) {
		return [];
	}

	const servers: LanguageServerConfig[] = [];
	for (const [serverIndex, server] of parsed.data.servers.entries()) {
		const serverResult = serverSchema.safeParse(server);
		if (serverResult.success) {
			servers.push(serverResult.data);
			continue;
		}

		const issues = serverResult.error.issues
			.map((issue) => {
				const issuePath = issue.path.join(".");
				if (issuePath.length > 0) {
					return `${issuePath}: ${issue.message}`;
				}
				return issue.message;
			})
			.join("; ");
		console.warn(
			`[LSP] Ignoring invalid LSP server entry in ${path} at index ${serverIndex}: ${issues}`
		);
	}

	return servers;
}

export function saveConfigFile(path: string, servers: LanguageServerConfig[]): void {
	for (const server of servers) {
		const result = serverSchema.safeParse(server);
		if (!result.success) {
			const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
			throw new Error(`Invalid server config "${server.id}": ${issues}`);
		}
	}

	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ servers }, null, "\t"), "utf8");
}

function normalizeExtension(extension: string): string | null {
	const trimmed = extension.trim().toLowerCase();
	if (!trimmed) {
		return null;
	}
	return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function getFileExtension(filePath: string): string | null {
	const lastDot = filePath.lastIndexOf(".");
	if (lastDot <= 0 || lastDot === filePath.length - 1) {
		return null;
	}
	return filePath.slice(lastDot).toLowerCase();
}

function interpolate(value: string, env: Record<string, string | undefined>): string {
	const withWorkspace = value.replaceAll("${workspaceFolder}", env["workspaceFolder"] ?? "");
	return withWorkspace.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => {
		return env[key] ?? "";
	});
}
