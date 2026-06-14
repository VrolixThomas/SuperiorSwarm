import { create } from "zustand";
import { ALL_BANDS, type BandId } from "../utils/sidebar-bands";

const STORAGE_KEY = "ss.sidebar.bands.v1";
const LEGACY_ORCH_COLLAPSED = "ss.sidebar.orchCollapsed";

export interface BandPersistedState {
	order: BandId[];
	open: Record<BandId, boolean>;
	heights: Record<BandId, number | null>;
}

export function defaultBandState(): BandPersistedState {
	return {
		order: [...ALL_BANDS],
		open: { folders: true, repositories: true, orchestrators: true },
		heights: { folders: null, repositories: null, orchestrators: null },
	};
}

export function sanitizeOrder(input: unknown[]): BandId[] {
	const seen = new Set<BandId>();
	const out: BandId[] = [];
	for (const x of input) {
		const id = x as BandId;
		if (ALL_BANDS.includes(id) && !seen.has(id)) {
			out.push(id);
			seen.add(id);
		}
	}
	for (const id of ALL_BANDS) {
		if (!seen.has(id)) out.push(id);
	}
	return out;
}

export function parsePersisted(
	raw: string | null,
	legacyOrchCollapsed: string | null
): BandPersistedState {
	const base = defaultBandState();
	if (raw) {
		try {
			const p = JSON.parse(raw) as Partial<BandPersistedState>;
			if (Array.isArray(p.order)) base.order = sanitizeOrder(p.order);
			if (p.open && typeof p.open === "object") {
				for (const id of ALL_BANDS) {
					if (typeof p.open[id] === "boolean") base.open[id] = p.open[id] as boolean;
				}
			}
			if (p.heights && typeof p.heights === "object") {
				for (const id of ALL_BANDS) {
					const h = p.heights[id];
					if ((typeof h === "number" && h > 0) || h === null) base.heights[id] = h;
				}
			}
			return base;
		} catch {
			return defaultBandState();
		}
	}
	if (legacyOrchCollapsed != null) {
		base.open.orchestrators = legacyOrchCollapsed !== "true";
	}
	return base;
}

function readStorage(): BandPersistedState {
	if (typeof window === "undefined") return defaultBandState();
	try {
		return parsePersisted(
			window.localStorage.getItem(STORAGE_KEY),
			window.localStorage.getItem(LEGACY_ORCH_COLLAPSED)
		);
	} catch {
		return defaultBandState();
	}
}

function writeStorage(state: BandPersistedState): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ order: state.order, open: state.open, heights: state.heights })
		);
	} catch {}
}

interface SidebarBandsStore extends BandPersistedState {
	hydrated: boolean;
	hydrate: () => void;
	toggleOpen: (id: BandId) => void;
	setOrder: (order: BandId[]) => void;
	setHeight: (id: BandId, height: number | null) => void;
}

export const useSidebarBandsStore = create<SidebarBandsStore>((set, get) => ({
	// Initialise from storage so an early mutation can't persist defaults over
	// the user's saved settings before the mount-time hydrate() runs.
	...readStorage(),
	hydrated: false,
	hydrate: () => {
		if (get().hydrated) return;
		set({ ...readStorage(), hydrated: true });
	},
	toggleOpen: (id) => {
		set((s) => ({ open: { ...s.open, [id]: !s.open[id] } }));
		writeStorage(get());
	},
	setOrder: (order) => {
		set({ order: sanitizeOrder(order) });
		writeStorage(get());
	},
	setHeight: (id, height) => {
		set((s) => ({ heights: { ...s.heights, [id]: height } }));
		writeStorage(get());
	},
}));
