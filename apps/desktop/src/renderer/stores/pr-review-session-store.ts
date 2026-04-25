import { create } from "zustand";

export interface PRReviewSession {
	activeFilePath: string | null;
	activeThreadId: string | null;
	scrollByFile: Map<string, number>;
	overviewScrollTop: number;
	fileOrder: string[];
	threadOrder: string[];
}

export interface PRReviewSessionStore {
	sessions: Map<string, PRReviewSession>;

	selectFile: (key: string, path: string | null) => void;
	advanceFile: (key: string, delta: 1 | -1) => void;
	selectThread: (key: string, id: string | null) => void;
	advanceThread: (key: string, delta: 1 | -1) => void;
	setScroll: (key: string, path: string, top: number) => void;
	getScroll: (key: string, path: string) => number | undefined;
	setOverviewScroll: (key: string, top: number) => void;
	setFileOrder: (key: string, files: string[]) => void;
	setThreadOrder: (key: string, ids: string[]) => void;
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

function withSession(
	state: PRReviewSessionStore,
	key: string,
	mut: (s: PRReviewSession) => PRReviewSession
): Map<string, PRReviewSession> {
	const next = new Map(state.sessions);
	const cur = next.get(key) ?? emptySession();
	next.set(key, mut({ ...cur }));
	return next;
}

export const usePRReviewSessionStore = create<PRReviewSessionStore>()((set, get) => ({
	sessions: new Map(),

	selectFile: (key, path) =>
		set((state) => ({
			sessions: withSession(state, key, (s) => ({ ...s, activeFilePath: path })),
		})),

	advanceFile: (key, delta) =>
		set((state) => ({
			sessions: withSession(state, key, (s) => {
				if (s.fileOrder.length === 0) return s;
				if (s.activeFilePath === null) {
					return { ...s, activeFilePath: s.fileOrder[0] ?? null };
				}
				const idx = s.fileOrder.indexOf(s.activeFilePath);
				if (idx === -1) return { ...s, activeFilePath: s.fileOrder[0] ?? null };
				const nextIdx = Math.min(s.fileOrder.length - 1, Math.max(0, idx + delta));
				return { ...s, activeFilePath: s.fileOrder[nextIdx] ?? null };
			}),
		})),

	selectThread: (key, id) =>
		set((state) => ({
			sessions: withSession(state, key, (s) => ({ ...s, activeThreadId: id })),
		})),

	advanceThread: (_key, _delta) => {
		// implemented in Task 3
	},

	setScroll: (key, path, top) =>
		set((state) => ({
			sessions: withSession(state, key, (s) => {
				const m = new Map(s.scrollByFile);
				m.set(path, top);
				return { ...s, scrollByFile: m };
			}),
		})),

	getScroll: (key, path) => get().sessions.get(key)?.scrollByFile.get(path),

	setOverviewScroll: (key, top) =>
		set((state) => ({
			sessions: withSession(state, key, (s) => ({ ...s, overviewScrollTop: top })),
		})),

	setFileOrder: (key, files) =>
		set((state) => ({
			sessions: withSession(state, key, (s) => {
				const next = [...files];
				const wasActive = s.activeFilePath != null;
				const stillThere = wasActive && next.includes(s.activeFilePath!);
				return {
					...s,
					fileOrder: next,
					activeFilePath: wasActive && !stillThere ? (next[0] ?? null) : s.activeFilePath,
				};
			}),
		})),

	setThreadOrder: (key, ids) =>
		set((state) => ({
			sessions: withSession(state, key, (s) => ({ ...s, threadOrder: [...ids] })),
		})),
}));
