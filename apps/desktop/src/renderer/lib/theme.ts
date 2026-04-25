import type { ThemePref } from "../../shared/types";

export type { ThemePref };
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme-paint-cache";

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
	if (pref === "system") return systemDark ? "dark" : "light";
	return pref;
}

export function applyTheme(resolved: ResolvedTheme): void {
	document.documentElement.dataset.theme = resolved;
	try {
		localStorage.setItem(STORAGE_KEY, resolved);
	} catch {
		// localStorage may be unavailable; not fatal
	}
}

export function readPaintCache(): ResolvedTheme | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === "light" || v === "dark" ? v : null;
	} catch {
		return null;
	}
}

export function systemPrefersDark(): boolean {
	return matchMedia("(prefers-color-scheme: dark)").matches;
}

export function watchSystemTheme(cb: (dark: boolean) => void): () => void {
	const mql = matchMedia("(prefers-color-scheme: dark)");
	const handler = (e: MediaQueryListEvent) => cb(e.matches);
	mql.addEventListener("change", handler);
	return () => mql.removeEventListener("change", handler);
}
