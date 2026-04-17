import { z } from "zod";

export const MAX_INIT_OPTIONS_BYTES = 64 * 1024;

export const SERVER_ID_REGEX = /^[a-z][a-z0-9-]{1,30}$/;

export const languageServerConfigSchema = z.object({
	id: z
		.string()
		.regex(
			SERVER_ID_REGEX,
			"id must be 2-31 chars, start with a lowercase letter, and contain only lowercase letters, digits, or hyphens"
		),
	command: z.string().min(1),
	args: z.array(z.string()).default([]),
	languages: z.array(z.string().min(1)).default([]),
	fileExtensions: z.array(z.string().min(1)).default([]),
	fileNames: z.array(z.string().min(1)).default([]),
	rootMarkers: z.array(z.string().min(1)).default([".git"]),
	initializationOptions: z
		.record(z.string(), z.unknown())
		.optional()
		.refine(
			(val) => {
				if (!val) return true;
				try {
					return JSON.stringify(val).length <= MAX_INIT_OPTIONS_BYTES;
				} catch {
					return false;
				}
			},
			{ message: `initializationOptions exceeds ${MAX_INIT_OPTIONS_BYTES} bytes` }
		),
	disabled: z.boolean().default(false),
});

export type LanguageServerConfig = z.infer<typeof languageServerConfigSchema>;

type LanguageServerConfigSeed = Pick<LanguageServerConfig, "id" | "command"> &
	Partial<Omit<LanguageServerConfig, "id" | "command">>;

export function defineServerConfig(seed: LanguageServerConfigSeed): LanguageServerConfig {
	return {
		args: [],
		languages: [],
		fileExtensions: [],
		fileNames: [],
		rootMarkers: [".git"],
		disabled: false,
		...seed,
	};
}

export interface LspPreset {
	id: string;
	displayName: string;
	description: string;
	config: LanguageServerConfig;
}

export interface LspDetectSuggestion {
	id: string;
	displayName: string;
	fileCount: number;
	sampleFiles: string[];
}

export function normalizeExtension(extension: string): string | null {
	const trimmed = extension.trim().toLowerCase();
	if (!trimmed) return null;
	return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}
