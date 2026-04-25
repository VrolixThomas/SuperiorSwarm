import { create } from "zustand";
import {
	type ResolvedTheme,
	type ThemePref,
	applyTheme,
	resolveTheme,
	systemPrefersDark,
	watchSystemTheme,
} from "../lib/theme";
import { trpcVanilla } from "../trpc/client";

interface ThemeState {
	pref: ThemePref;
	resolved: ResolvedTheme;
	setPref: (p: ThemePref) => Promise<void>;
	hydrate: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
	pref: "system",
	resolved: systemPrefersDark() ? "dark" : "light",

	setPref: async (p) => {
		await trpcVanilla.settings.setTheme.mutate(p);
		const resolved = resolveTheme(p, systemPrefersDark());
		applyTheme(resolved);
		set({ pref: p, resolved });
	},

	hydrate: async () => {
		const pref = await trpcVanilla.settings.getTheme.query();
		const resolved = resolveTheme(pref, systemPrefersDark());
		applyTheme(resolved);
		set({ pref, resolved });
	},
}));

// OS theme follow when pref === "system"
const unsubSystem = watchSystemTheme((dark) => {
	const { pref } = useThemeStore.getState();
	if (pref !== "system") return;
	const resolved: ResolvedTheme = dark ? "dark" : "light";
	applyTheme(resolved);
	useThemeStore.setState({ resolved });
});

// Sync across windows via main-process broadcast
const unsubBroadcast = window.electron?.settings?.onThemeChanged((value) => {
	if (useThemeStore.getState().pref === value) return;
	const resolved = resolveTheme(value, systemPrefersDark());
	applyTheme(resolved);
	useThemeStore.setState({ pref: value, resolved });
});

// Vite HMR cleanup: dispose listeners when this module is re-evaluated
const hot = (import.meta as ImportMeta & { hot?: { dispose: (cb: () => void) => void } }).hot;
if (hot) {
	hot.dispose(() => {
		unsubSystem();
		unsubBroadcast?.();
	});
}
