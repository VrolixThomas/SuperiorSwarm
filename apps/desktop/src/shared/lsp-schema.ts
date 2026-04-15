import { z } from "zod";

export const languageServerConfigSchema = z.object({
	id: z.string().min(1),
	command: z.string().min(1),
	args: z.array(z.string()).default([]),
	languages: z.array(z.string().min(1)).default([]),
	fileExtensions: z.array(z.string().min(1)).default([]),
	fileNames: z.array(z.string().min(1)).default([]),
	installHint: z.string().min(1).optional(),
	rootMarkers: z.array(z.string().min(1)).default([".git"]),
	initializationOptions: z.record(z.string(), z.unknown()).optional(),
	disabled: z.boolean().default(false),
});

export type LanguageServerConfig = z.infer<typeof languageServerConfigSchema>;

export interface LspPreset {
	id: string;
	displayName: string;
	description: string;
	config: LanguageServerConfig;
}
