import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
	type LanguageServerConfig,
	defineServerConfig,
	languageServerConfigSchema,
	normalizeExtension,
} from "../../shared/lsp-schema";
import { zodIssuesToString } from "../../shared/lsp-zod-errors";
import { LruMap } from "./lru-map";

const serverSchema = languageServerConfigSchema;

const configFileSchema = z.object({
	servers: z.array(z.unknown()).default([]),
});

export type { LanguageServerConfig };

export interface LanguageRegistry {
	byId: Map<string, LanguageServerConfig>;
	byLanguageId: Map<string, LanguageServerConfig[]>;
	byExtension: Map<string, LanguageServerConfig[]>;
	byFileName: Map<string, LanguageServerConfig[]>;
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

// Invariant: BUILT_IN_SERVER_IDS in ../../shared/lsp-builtin-ids.ts must match these ids.
// Test enforces it — see tests/lsp-builtin-ids.test.ts.
export const DEFAULT_SERVER_CONFIGS: LanguageServerConfig[] = [
	defineServerConfig({
		id: "typescript",
		command: "typescript-language-server",
		args: ["--stdio"],
		languages: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
		fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		rootMarkers: ["package.json", "tsconfig.json", ".git"],
	}),
	defineServerConfig({
		id: "python",
		command: "pyright-langserver",
		args: ["--stdio"],
		languages: ["python"],
		fileExtensions: [".py"],
		rootMarkers: ["pyproject.toml", "setup.py", ".git"],
	}),
	defineServerConfig({
		id: "go",
		command: "gopls",
		languages: ["go"],
		fileExtensions: [".go"],
		rootMarkers: ["go.mod", ".git"],
	}),
	defineServerConfig({
		id: "rust",
		command: "rust-analyzer",
		languages: ["rust"],
		fileExtensions: [".rs"],
		rootMarkers: ["Cargo.toml", ".git"],
	}),
	defineServerConfig({
		id: "java",
		command: "jdtls",
		languages: ["java"],
		fileExtensions: [".java"],
		rootMarkers: ["pom.xml", "build.gradle", ".git"],
	}),
	defineServerConfig({
		id: "cpp",
		command: "clangd",
		languages: ["cpp", "c"],
		fileExtensions: [".cc", ".cpp", ".c", ".h", ".hpp"],
		rootMarkers: ["compile_commands.json", ".git"],
	}),
	defineServerConfig({
		id: "php",
		command: "intelephense",
		args: ["--stdio"],
		languages: ["php"],
		fileExtensions: [".php"],
		rootMarkers: ["composer.json", ".git"],
	}),
	defineServerConfig({
		id: "ruby",
		command: "solargraph",
		args: ["stdio"],
		languages: ["ruby"],
		fileExtensions: [".rb"],
		rootMarkers: ["Gemfile", ".git"],
	}),
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
	const byFileName = new Map<string, LanguageServerConfig[]>();

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

		for (const name of config.fileNames) {
			const normalized = name.trim();
			if (!normalized) continue;
			const existing = byFileName.get(normalized) ?? [];
			existing.push(config);
			byFileName.set(normalized, existing);
		}
	}

	return {
		byId: merged,
		byLanguageId,
		byExtension,
		byFileName,
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

	const basename = input.filePath.split(/[\\/]/).pop();
	if (basename) {
		const byName = registry.byFileName.get(basename)?.[0];
		if (byName) {
			return {
				supported: true,
				config: byName,
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

		console.warn(
			`[LSP] Ignoring invalid LSP server entry in ${path} at index ${serverIndex}: ${zodIssuesToString(serverResult.error.issues)}`
		);
	}

	return servers;
}

export function saveConfigFile(path: string, servers: LanguageServerConfig[]): void {
	for (const [index, server] of servers.entries()) {
		const result = serverSchema.safeParse(server);
		if (!result.success) {
			// Prepend the server index so the renderer can thread issues back to
			// the offending entry (the tRPC error formatter forwards this as
			// `data.zodIssues` verbatim).
			const rescoped = result.error.issues.map((issue) => ({
				...issue,
				path: [index, ...issue.path],
			}));
			const err = new z.ZodError(rescoped);
			throw err;
		}
	}

	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	try {
		writeFileSync(tmp, JSON.stringify({ servers }, null, "\t"), "utf8");
		renameSync(tmp, path);
	} catch (err) {
		try {
			unlinkSync(tmp);
		} catch {
			// best effort — tmp never created or already gone
		}
		throw err;
	}
	fsCache.delete(path);
}

function getFileExtension(filePath: string): string | null {
	const lastDot = filePath.lastIndexOf(".");
	if (lastDot <= 0 || lastDot === filePath.length - 1) {
		return null;
	}
	return filePath.slice(lastDot).toLowerCase();
}

const ALLOWED_ENV_KEYS = new Set([
	"HOME",
	"USER",
	"PATH",
	"SHELL",
	"DOTNET_ROOT",
	"JAVA_HOME",
	"GOPATH",
	"GOROOT",
	"CARGO_HOME",
	"RUSTUP_HOME",
	"NVM_DIR",
	"NODE_PATH",
	"VIRTUAL_ENV",
	"CONDA_PREFIX",
	"PYENV_ROOT",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
]);

function interpolate(value: string, env: Record<string, string | undefined>): string {
	const withWorkspace = value.replaceAll("${workspaceFolder}", env["workspaceFolder"] ?? "");
	return withWorkspace.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key: string) => {
		if (!ALLOWED_ENV_KEYS.has(key)) {
			console.warn(`[LSP] Refusing to expand disallowed env var: ${key}`);
			return match;
		}
		return env[key] ?? "";
	});
}

// ---------------------------------------------------------------------------
// FS-level cache keyed on absolute config path + mtime
// ---------------------------------------------------------------------------

interface CacheEntry {
	mtimeMs: number;
	servers: LanguageServerConfig[];
}

const FS_CACHE_MAX_SIZE = 1024;
const fsCache = new LruMap<string, CacheEntry>(FS_CACHE_MAX_SIZE);

export function _clearRegistryFsCache(): void {
	fsCache.clear();
}

function loadConfigFileCached(path: string): LanguageServerConfig[] {
	let mtimeMs: number;
	try {
		mtimeMs = statSync(path).mtimeMs;
	} catch {
		const cached = fsCache.get(path);
		if (cached && cached.mtimeMs === -1) return cached.servers;
		const empty: LanguageServerConfig[] = [];
		fsCache.set(path, { mtimeMs: -1, servers: empty });
		return empty;
	}

	const cached = fsCache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.servers;

	const servers = loadConfigFile(path);
	fsCache.set(path, { mtimeMs, servers });
	return servers;
}

export function loadUserConfigCached(): LanguageServerConfig[] {
	return loadConfigFileCached(join(homedir(), ".config", "superiorswarm", "lsp.json"));
}

export function loadRepoConfigCached(repoPath: string): LanguageServerConfig[] {
	return loadConfigFileCached(join(repoPath, ".superiorswarm", "lsp.json"));
}
