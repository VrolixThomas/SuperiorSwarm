/**
 * One-time initialization of @codingame/monaco-vscode-api.
 * Must be called before creating any Monaco editor instances.
 * Safe to call multiple times — only runs once.
 */
let initPromise: Promise<void> | null = null;

export function initializeVSCodeApi(): Promise<void> {
	if (initPromise) return initPromise;
	initPromise = _init();
	return initPromise;
}

async function _init(): Promise<void> {
	// Dynamic imports keep these large packages out of the initial bundle.
	// They load only when the diff viewer is first opened.
	const [
		{ initialize },
		{ default: getEditorServiceOverride },
		{ default: getLanguagesServiceOverride },
		{ default: getThemeServiceOverride },
		{ default: getTextmateServiceOverride },
	] = await Promise.all([
		import("@codingame/monaco-vscode-api"),
		import("@codingame/monaco-vscode-editor-service-override"),
		import("@codingame/monaco-vscode-languages-service-override"),
		import("@codingame/monaco-vscode-theme-service-override"),
		import("@codingame/monaco-vscode-textmate-service-override"),
	]);

	// initialize takes IEditorOverrideServices directly (spread of each override's return value).
	// The editor service override intercepts "open editor" requests so navigation stays
	// within DiffEditor rather than trying to open new browser tabs.
	await initialize({
		...getEditorServiceOverride(async () => undefined),
		...getLanguagesServiceOverride(),
		...getThemeServiceOverride(),
		...getTextmateServiceOverride(),
	});
}
