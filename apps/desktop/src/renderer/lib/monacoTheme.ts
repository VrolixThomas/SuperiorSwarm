import * as monaco from "monaco-editor";

export const EDITOR_THEME_DARK = "superiorswarm-dark";
export const EDITOR_THEME_LIGHT = "superiorswarm-light";

let registered = false;

export function ensureThemeRegistered(): void {
	if (registered) return;

	monaco.editor.defineTheme(EDITOR_THEME_DARK, {
		base: "vs-dark",
		inherit: true,
		rules: [],
		colors: {
			"editor.background": "#161618",
			"diffEditor.insertedTextBackground": "#1a3a2a80",
			"diffEditor.removedTextBackground": "#3a1a1a80",
			"diffEditor.insertedLineBackground": "#1a3a2a40",
			"diffEditor.removedLineBackground": "#3a1a1a40",
		},
	});

	monaco.editor.defineTheme(EDITOR_THEME_LIGHT, {
		base: "vs",
		inherit: true,
		rules: [],
		colors: {
			"editor.background": "#ffffff",
			"diffEditor.insertedTextBackground": "#aaf0c080",
			"diffEditor.removedTextBackground": "#ffc4c480",
			"diffEditor.insertedLineBackground": "#dcffe4",
			"diffEditor.removedLineBackground": "#ffe7e7",
		},
	});

	registered = true;
	syncMonacoTheme();
	startThemeWatcher();
}

function syncMonacoTheme(): void {
	const t =
		document.documentElement.dataset.theme === "light" ? EDITOR_THEME_LIGHT : EDITOR_THEME_DARK;
	monaco.editor.setTheme(t);
}

let watcherStarted = false;
function startThemeWatcher(): void {
	if (watcherStarted) return;
	watcherStarted = true;
	const obs = new MutationObserver(syncMonacoTheme);
	obs.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
}

// Backwards-compat re-export for existing imports of EDITOR_THEME
export const EDITOR_THEME = EDITOR_THEME_DARK;
