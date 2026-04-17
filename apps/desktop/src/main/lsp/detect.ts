import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { LanguageServerConfig, LspDetectSuggestion } from "../../shared/lsp-schema";
import { LSP_PRESETS } from "./presets";
import { DEFAULT_SERVER_CONFIGS } from "./registry";

export interface DetectOptions {
	alreadyConfigured: Set<string>;
	maxFiles?: number;
	maxDepth?: number;
}

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_DEPTH = 6;
const SAMPLE_LIMIT = 3;

const IGNORED_DIRS = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"dist",
	"build",
	"out",
	".next",
	".nuxt",
	".turbo",
	".cache",
	"target",
	".venv",
	"venv",
	"__pycache__",
	"vendor",
	".gradle",
	".idea",
	".vscode",
	"coverage",
	".pytest_cache",
	".mypy_cache",
]);

interface CandidateIndex {
	id: string;
	displayName: string;
	extensions: Set<string>;
	fileNames: Set<string>;
}

function buildIndex(skip: Set<string>): CandidateIndex[] {
	const seen = new Set<string>();
	const index: CandidateIndex[] = [];

	const add = (id: string, displayName: string, cfg: LanguageServerConfig) => {
		if (skip.has(id) || seen.has(id)) return;
		seen.add(id);
		const extensions = new Set(cfg.fileExtensions.map((e) => e.toLowerCase()));
		const fileNames = new Set(cfg.fileNames);
		if (extensions.size === 0 && fileNames.size === 0) return;
		index.push({ id, displayName, extensions, fileNames });
	};

	for (const cfg of DEFAULT_SERVER_CONFIGS) {
		add(cfg.id, cfg.id, cfg);
	}
	for (const preset of LSP_PRESETS) {
		add(preset.id, preset.displayName, preset.config);
	}

	return index;
}

export function detectSuggestions(repoPath: string, opts: DetectOptions): LspDetectSuggestion[] {
	const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
	const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
	const index = buildIndex(opts.alreadyConfigured);

	const hits = new Map<string, { displayName: string; count: number; samples: string[] }>();

	let filesSeen = 0;
	const stack: Array<{ path: string; depth: number }> = [{ path: repoPath, depth: 0 }];

	while (stack.length > 0) {
		const entry = stack.pop();
		if (!entry) break;
		if (filesSeen >= maxFiles) break;

		let children;
		try {
			children = readdirSync(entry.path, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const dirent of children) {
			if (filesSeen >= maxFiles) break;
			const name = dirent.name;
			if (IGNORED_DIRS.has(name)) continue;
			if (name.startsWith(".") && name !== ".env") {
				// Most dotfiles are noise; keep this guard conservative so
				// we don't traverse `.git` siblings or editor metadata.
				continue;
			}
			// Skip symlinks to avoid cycles and escapes from the repo root.
			if (dirent.isSymbolicLink()) continue;

			const childPath = join(entry.path, name);

			if (dirent.isDirectory()) {
				if (entry.depth + 1 <= maxDepth) {
					stack.push({ path: childPath, depth: entry.depth + 1 });
				}
				continue;
			}

			if (!dirent.isFile()) continue;
			filesSeen++;

			const rel = childPath.slice(repoPath.length + 1) || name;
			const base = basename(name);
			const ext = extname(name).toLowerCase();

			for (const candidate of index) {
				const match = candidate.fileNames.has(base) || candidate.extensions.has(ext);
				if (!match) continue;

				let bucket = hits.get(candidate.id);
				if (!bucket) {
					bucket = { displayName: candidate.displayName, count: 0, samples: [] };
					hits.set(candidate.id, bucket);
				}
				bucket.count += 1;
				if (bucket.samples.length < SAMPLE_LIMIT) {
					bucket.samples.push(rel);
				}
			}
		}
	}

	const result: LspDetectSuggestion[] = [];
	for (const [id, bucket] of hits) {
		result.push({
			id,
			displayName: bucket.displayName,
			fileCount: bucket.count,
			sampleFiles: bucket.samples,
		});
	}
	result.sort((a, b) => b.fileCount - a.fileCount);
	return result;
}
