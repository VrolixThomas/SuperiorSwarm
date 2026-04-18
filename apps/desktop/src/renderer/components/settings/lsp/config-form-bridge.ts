import type { LanguageServerConfig } from "../../../../shared/lsp-schema";
import { parseArgs, stringifyArgs } from "../../../lsp/arg-parse";
import type { ServerFormData } from "./LspServerForm";

export function configToFormData(config: LanguageServerConfig): ServerFormData {
	return {
		id: config.id,
		command: config.command,
		args: stringifyArgs(config.args),
		fileExtensions: config.fileExtensions.join(", "),
		fileNames: config.fileNames.join(", "),
		languages: config.languages.join(", "),
		rootMarkers: config.rootMarkers.join(", "),
		initializationOptions: config.initializationOptions
			? JSON.stringify(config.initializationOptions, null, 2)
			: "",
	};
}

export function splitCsv(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

// Merges form edits onto `original` so unknown fields survive round-trips.
export function formDataToConfig(
	data: ServerFormData,
	original: LanguageServerConfig | null
): LanguageServerConfig {
	const initOptsRaw = data.initializationOptions.trim();
	let initOpts: Record<string, unknown> | undefined;

	if (!initOptsRaw) {
		initOpts = undefined;
	} else {
		try {
			const parsed = JSON.parse(initOptsRaw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				initOpts = parsed;
			} else {
				// Not an object / malformed — keep prior value rather than silently clearing.
				initOpts = original?.initializationOptions;
			}
		} catch {
			initOpts = original?.initializationOptions;
		}
	}

	const base: LanguageServerConfig = original ?? {
		id: data.id,
		command: "",
		args: [],
		languages: [],
		fileExtensions: [],
		fileNames: [],
		rootMarkers: [".git"],
		disabled: false,
	};

	return {
		...base,
		id: data.id,
		command: data.command.trim(),
		args: parseArgs(data.args),
		languages: splitCsv(data.languages),
		fileExtensions: splitCsv(data.fileExtensions),
		fileNames: splitCsv(data.fileNames),
		rootMarkers: splitCsv(data.rootMarkers),
		initializationOptions: initOpts,
		disabled: base.disabled,
	};
}
