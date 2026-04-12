export interface LanguageServerConfig {
	id: string;
	command: string;
	args: string[];
	languages: string[];
	fileExtensions: string[];
	installHint?: string;
	rootMarkers: string[];
	initializationOptions?: Record<string, unknown>;
	disabled: boolean;
}

export interface LspPreset {
	id: string;
	displayName: string;
	description: string;
	config: LanguageServerConfig;
}
