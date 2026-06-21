export type CliPresetName = "claude" | "gemini" | "codex" | "opencode";

export const CLI_PRESET_NAMES = [
	"claude",
	"gemini",
	"codex",
	"opencode",
] as const satisfies readonly CliPresetName[];
