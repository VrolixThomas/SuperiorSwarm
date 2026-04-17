import { type LanguageServerConfig, normalizeExtension } from "../../../../shared/lsp-schema";

export interface ConflictInfo {
	/** Ids of earlier (higher-precedence) entries that claim the same match. */
	overlappingWith: string[];
}

/**
 * Scan the resolution order from first to last and flag any entry whose
 * languages/extensions/fileNames overlap with an earlier entry. The caller
 * controls precedence via list order — detection mirrors the first-match
 * resolution used in the registry.
 */
export function detectConflicts(configs: LanguageServerConfig[]): Map<string, ConflictInfo> {
	const result = new Map<string, ConflictInfo>();

	const seen = {
		languages: new Map<string, string[]>(),
		extensions: new Map<string, string[]>(),
		fileNames: new Map<string, string[]>(),
	};

	const collect = (bag: Map<string, string[]>, key: string, overlaps: Set<string>, id: string) => {
		const earlier = bag.get(key);
		if (!earlier) return;
		for (const prev of earlier) {
			if (prev !== id) overlaps.add(prev);
		}
	};

	for (const config of configs) {
		if (config.disabled) continue;

		const overlaps = new Set<string>();

		for (const lang of config.languages) collect(seen.languages, lang, overlaps, config.id);
		for (const ext of config.fileExtensions) {
			const normalized = normalizeExtension(ext);
			if (normalized) collect(seen.extensions, normalized, overlaps, config.id);
		}
		for (const name of config.fileNames) collect(seen.fileNames, name, overlaps, config.id);

		if (overlaps.size > 0) {
			result.set(config.id, { overlappingWith: [...overlaps] });
		}

		const push = (bag: Map<string, string[]>, key: string) => {
			const list = bag.get(key);
			if (list) list.push(config.id);
			else bag.set(key, [config.id]);
		};
		for (const lang of config.languages) push(seen.languages, lang);
		for (const ext of config.fileExtensions) {
			const normalized = normalizeExtension(ext);
			if (normalized) push(seen.extensions, normalized);
		}
		for (const name of config.fileNames) push(seen.fileNames, name);
	}

	return result;
}
