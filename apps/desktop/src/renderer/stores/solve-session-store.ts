import { create } from "zustand";

export interface SolveSession {
	activeFilePath: string | null;
	activeCommentId: string | null;
	scrollByFile: Map<string, number>;
	expandedGroupIds: Set<string>;
	fileOrder: string[];
}

export interface SolveSessionStore {
	sessions: Map<string, SolveSession>;

	selectFile: (key: string, path: string | null) => void;
	advanceFile: (key: string, delta: 1 | -1) => void;
	selectComment: (key: string, id: string | null) => void;
	setScroll: (key: string, path: string, top: number) => void;
	getScroll: (key: string, path: string) => number | undefined;
	setFileOrder: (key: string, files: string[]) => void;
	toggleGroupExpanded: (key: string, groupId: string) => void;
	setExpandedGroups: (key: string, groupIds: Set<string>) => void;
	dropSession: (key: string) => void;
}

function emptySession(): SolveSession {
	return {
		activeFilePath: null,
		activeCommentId: null,
		scrollByFile: new Map(),
		expandedGroupIds: new Set(),
		fileOrder: [],
	};
}

function withSession(
	state: SolveSessionStore,
	key: string,
	mut: (s: SolveSession) => SolveSession
): Map<string, SolveSession> {
	const cur = state.sessions.get(key) ?? emptySession();
	const next = mut(cur);
	if (next === cur) return state.sessions;
	const map = new Map(state.sessions);
	map.set(key, next);
	return map;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export const useSolveSessionStore = create<SolveSessionStore>()((set, get) => ({
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

	selectComment: (key, id) =>
		set((state) => {
			const next = withSession(state, key, (s) =>
				s.activeCommentId === id ? s : { ...s, activeCommentId: id }
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

	setFileOrder: (key, files) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				const orderUnchanged = arraysEqual(s.fileOrder, files);
				const stillThere = s.activeFilePath != null && files.includes(s.activeFilePath);
				const nextActive =
					s.activeFilePath != null && !stillThere ? (files[0] ?? null) : s.activeFilePath;
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
				if (orderUnchanged && nextActive === s.activeFilePath && scroll === s.scrollByFile) {
					return s;
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

	toggleGroupExpanded: (key, groupId) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				const expanded = new Set(s.expandedGroupIds);
				if (expanded.has(groupId)) expanded.delete(groupId);
				else expanded.add(groupId);
				return { ...s, expandedGroupIds: expanded };
			});
			return next === state.sessions ? state : { sessions: next };
		}),

	setExpandedGroups: (key, groupIds) =>
		set((state) => {
			const next = withSession(state, key, (s) => {
				if (s.expandedGroupIds.size === groupIds.size) {
					let allMatch = true;
					for (const id of groupIds) {
						if (!s.expandedGroupIds.has(id)) {
							allMatch = false;
							break;
						}
					}
					if (allMatch) return s;
				}
				return { ...s, expandedGroupIds: new Set(groupIds) };
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
}));
