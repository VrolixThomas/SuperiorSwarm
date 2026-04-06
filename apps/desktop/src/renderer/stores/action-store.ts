import { create } from "zustand";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Shortcut {
	key: string;
	meta?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export type ActionCategory =
	| "Git"
	| "Navigation"
	| "Pane"
	| "View"
	| "Branch"
	| "Terminal"
	| "General"
	| "Quick Actions";

export const CATEGORY_ORDER: ActionCategory[] = [
	"General",
	"Quick Actions",
	"Git",
	"Navigation",
	"Branch",
	"View",
	"Pane",
	"Terminal",
];

export interface Action {
	id: string;
	label: string;
	category: ActionCategory;
	shortcut?: Shortcut;
	when?: () => boolean;
	execute: () => void;
	keywords?: string[];
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface ActionStore {
	actions: Map<string, Action>;
	register: (action: Action) => void;
	registerMany: (actions: Action[]) => void;
	unregister: (id: string) => void;
	unregisterMany: (ids: string[]) => void;
	execute: (id: string) => void;
	getAvailable: () => Action[];
	getShortcutForId: (id: string) => Shortcut | undefined;

	isPaletteOpen: boolean;
	openPalette: () => void;
	closePalette: () => void;
}

export const useActionStore = create<ActionStore>()((set, get) => ({
	actions: new Map(),
	isPaletteOpen: false,

	register: (action) => {
		const next = new Map(get().actions);
		next.set(action.id, action);
		set({ actions: next });
	},

	registerMany: (actions) => {
		const next = new Map(get().actions);
		for (const action of actions) {
			next.set(action.id, action);
		}
		set({ actions: next });
	},

	unregister: (id) => {
		const next = new Map(get().actions);
		next.delete(id);
		set({ actions: next });
	},

	unregisterMany: (ids) => {
		const next = new Map(get().actions);
		for (const id of ids) {
			next.delete(id);
		}
		set({ actions: next });
	},

	execute: (id) => {
		const action = get().actions.get(id);
		if (!action) return;
		if (action.when && !action.when()) return;
		action.execute();
	},

	getAvailable: () => {
		const all = Array.from(get().actions.values());
		return all.filter((a) => !a.when || a.when());
	},

	getShortcutForId: (id) => {
		return get().actions.get(id)?.shortcut;
	},

	openPalette: () => set({ isPaletteOpen: true }),
	closePalette: () => set({ isPaletteOpen: false }),
}));
