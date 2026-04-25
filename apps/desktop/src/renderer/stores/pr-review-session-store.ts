import { create } from "zustand";

export interface PRReviewThreadRef {
	id: string;
	path: string;
}

export interface PRReviewSession {
	activeFilePath: string | null;
	activeThreadId: string | null;
	scrollByFile: Map<string, number>;
	overviewScrollTop: number;
	fileOrder: string[];
	threadOrder: PRReviewThreadRef[];
}

export interface PRReviewSessionStore {
	sessions: Map<string, PRReviewSession>;

	selectFile: (key: string, path: string | null) => void;
	advanceFile: (key: string, delta: 1 | -1) => void;
	selectThread: (key: string, id: string | null) => void;
	setScroll: (key: string, path: string, top: number) => void;
	getScroll: (key: string, path: string) => number | undefined;
	setOverviewScroll: (key: string, top: number) => void;
	setFileOrder: (key: string, files: string[]) => void;
	setThreadOrder: (key: string, refs: PRReviewThreadRef[]) => void;
	dropSession: (key: string) => void;
	dropSessionsForWorkspace: (workspaceId: string) => void;
}

export function prReviewSessionKey(workspaceId: string, prIdentifier: string): string {
	return `${workspaceId}::${prIdentifier}`;
}

function emptySession(): PRReviewSession {
	return {
		activeFilePath: null,
		activeThreadId: null,
		scrollByFile: new Map(),
		overviewScrollTop: 0,
		fileOrder: [],
		threadOrder: [],
	};
}

function arraysEqual<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const ai = a[i] as T;
		const bi = b[i] as T;
		if (!eq(ai, bi)) return false;
	}
	return true;
}

const refEq = (a: PRReviewThreadRef, b: PRReviewThreadRef) => a.id === b.id && a.path === b.path;
const strEq = (a: string, b: string) => a === b;

/**
 * Mutate a session and return the next sessions Map. Returns the same Map
 * (and same session object) when `mut` returns the existing session unchanged
 * — so equality-guarded setters can short-circuit without notifying subscribers.
 */
function withSession(
	state: PRReviewSessionStore,
	key: string,
	mut: (s: PRReviewSession) => PRReviewSession
): Map<string, PRReviewSession> {
	const cur = state.sessions.get(key) ?? emptySession();
	const next = mut(cur);
	if (next === cur) return state.sessions;
	const map = new Map(state.sessions);
	map.set(key, next);
	return map;
}

export const usePRReviewSessionStore = create<PRReviewSessionStore>()((set, get) => ({
	sessions: new Map(),

	selectFile: (key, path) =>
		set((state) => {
			const next = withSession(state, key, (s) =>
				s.activeFilePath === path ? s : { ...s, activeFilePath: path }
			);
			return next === state.sessions ? state : { sessions: next };
		}),

	advanceFile: (key, delta) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				if (s.fileOrder.length === 0) return s;
				if (s.activeFilePath === null) {
					return { ...s, activeFilePath: s.fileOrder[0] ?? null };
				}
				const idx = s.fileOrder.indexOf(s.activeFilePath);
				if (idx === -1) return { ...s, activeFilePath: s.fileOrder[0] ?? null };
				const nextIdx = Math.min(s.fileOrder.length - 1, Math.max(0, idx + delta));
				const nextPath = s.fileOrder[nextIdx] ?? null;
				return nextPath === s.activeFilePath ? s : { ...s, activeFilePath: nextPath };
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	selectThread: (key, id) =>
		set((state) => {
			const next = withSession(state, key, (s) =>
				s.activeThreadId === id ? s : { ...s, activeThreadId: id }
			);
			return next === state.sessions ? state : { sessions: next };
		}),

	setScroll: (key, path, top) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				if (s.scrollByFile.get(path) === top) return s;
				const m = new Map(s.scrollByFile);
				m.set(path, top);
				return { ...s, scrollByFile: m };
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	getScroll: (key, path) => get().sessions.get(key)?.scrollByFile.get(path),

	setOverviewScroll: (key, top) =>
		set((state) => {
			const next = withSession(state, key, (s) =>
				s.overviewScrollTop === top ? s : { ...s, overviewScrollTop: top }
			);
			return next === state.sessions ? state : { sessions: next };
		}),

	setFileOrder: (key, files) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				const orderUnchanged = arraysEqual(s.fileOrder, files, strEq);
				const stillThere = s.activeFilePath != null && files.includes(s.activeFilePath);
				const nextActive =
					s.activeFilePath != null && !stillThere ? (files[0] ?? null) : s.activeFilePath;
				if (orderUnchanged && nextActive === s.activeFilePath) return s;
				// scrollByFile shrinks too — drop entries for files no longer present
				const fileSet = new Set(files);
				let scroll = s.scrollByFile;
				let hasStale = false;
				for (const p of s.scrollByFile.keys()) {
					if (!fileSet.has(p)) {
						hasStale = true;
						break;
					}
				}
				if (hasStale) {
					scroll = new Map();
					for (const [p, top] of s.scrollByFile) if (fileSet.has(p)) scroll.set(p, top);
				}
				return {
					...s,
					fileOrder: orderUnchanged ? s.fileOrder : [...files],
					activeFilePath: nextActive,
					scrollByFile: scroll,
				};
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	setThreadOrder: (key, refs) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				const orderUnchanged = arraysEqual(s.threadOrder, refs, refEq);
				const stillThere = s.activeThreadId != null && refs.some((r) => r.id === s.activeThreadId);
				const nextActive = stillThere ? s.activeThreadId : null;
				if (orderUnchanged && nextActive === s.activeThreadId) return s;
				return {
					...s,
					threadOrder: orderUnchanged ? s.threadOrder : [...refs],
					activeThreadId: nextActive,
				};
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	dropSession: (key) =>
		set((state) => {
			if (!state.sessions.has(key)) return state;
			const map = new Map(state.sessions);
			map.delete(key);
			return { sessions: map };
		}),

	dropSessionsForWorkspace: (workspaceId) =>
		set((state) => {
			const prefix = `${workspaceId}::`;
			let map: Map<string, PRReviewSession> | null = null;
			for (const k of state.sessions.keys()) {
				if (k.startsWith(prefix)) {
					if (!map) map = new Map(state.sessions);
					map.delete(k);
				}
			}
			return map ? { sessions: map } : state;
		}),
}));
