import * as monaco from "monaco-editor";

export const EDITOR_THEME = "branchflux-dark";

let registered = false;

export function ensureThemeRegistered(): void {
	if (registered) return;
	monaco.editor.defineTheme(EDITOR_THEME, {
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
	registered = true;
}
