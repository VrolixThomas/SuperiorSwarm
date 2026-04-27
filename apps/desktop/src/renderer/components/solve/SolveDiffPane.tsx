import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { detectLanguage } from "../../../shared/diff-types";
import type { SolveGroupInfo, SolveSessionInfo } from "../../../shared/solve-types";
import { solveSessionKey, useSolveSessionStore } from "../../stores/solve-session-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { DiffEditor } from "../DiffEditor";
import { type Hint, ReviewHintBar } from "../review/ReviewHintBar";
import { SolveCommentWidget } from "./SolveCommentWidget";
import { useSolveCommentZones } from "./useSolveCommentZones";

const SOLVE_HINTS: Hint[] = [
	{ keys: ["J", "K"], label: "File" },
	{ keys: ["⇧J", "⇧K"], label: "Group" },
	{ keys: ["A"], label: "Approve" },
	{ keys: ["P"], label: "Push" },
	{ keys: ["⏎"], label: "Follow-up" },
	{ keys: ["Esc"], label: "Clear" },
];

interface Props {
	session: SolveSessionInfo;
	repoPath: string;
	workspaceId: string;
}

export function SolveDiffPane({ session, repoPath, workspaceId }: Props) {
	const sessionKey = solveSessionKey(session.workspaceId, session.id);
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);

	const activeFilePath = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const activeCommentId = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeCommentId ?? null
	);
	const commentsVisible = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.commentsVisible ?? true
	);
	const setScroll = useSolveSessionStore((s) => s.setScroll);
	const getScroll = useSolveSessionStore((s) => s.getScroll);
	const setCommentsVisible = useSolveSessionStore((s) => s.setCommentsVisible);
	const toggleCommentsVisible = useSolveSessionStore((s) => s.toggleCommentsVisible);
	const selectComment = useSolveSessionStore((s) => s.selectComment);
	const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(
		null
	);

	const selectedGroup: SolveGroupInfo | null = useMemo(() => {
		if (!activeFilePath) return null;
		for (const g of session.groups) {
			if (g.status === "reverted") continue;
			if (g.changedFiles.some((f) => f.path === activeFilePath)) return g;
			if (g.comments.some((c) => c.filePath === activeFilePath)) return g;
		}
		return null;
	}, [session.groups, activeFilePath]);

	const commitHash = selectedGroup?.commitHash ?? null;
	const language = activeFilePath ? detectLanguage(activeFilePath) : "plaintext";

	const originalQuery = trpc.diff.getFileContent.useQuery(
		{
			repoPath,
			ref: commitHash ? `${commitHash}~1` : "",
			filePath: activeFilePath ?? "",
		},
		{ enabled: !!commitHash && !!activeFilePath, staleTime: 60_000 }
	);
	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{
			repoPath,
			ref: commitHash ?? "",
			filePath: activeFilePath ?? "",
		},
		{ enabled: !!commitHash && !!activeFilePath, staleTime: 60_000 }
	);

	const fileComments = useMemo(() => {
		if (!selectedGroup || !activeFilePath) return [];
		return selectedGroup.comments.filter((c) => c.filePath === activeFilePath);
	}, [selectedGroup, activeFilePath]);

	const onGlyphClick = useCallback(
		(commentId: string) => {
			setCommentsVisible(sessionKey, true);
			selectComment(sessionKey, commentId);
		},
		[sessionKey, setCommentsVisible, selectComment]
	);

	useSolveCommentZones(editorInstance, fileComments, workspaceId, {
		enabled: commentsVisible,
		activeCommentId,
		onGlyphClick,
	});

	useEffect(() => {
		const ed = editorInstance?.getModifiedEditor();
		if (!ed || !activeFilePath) return;
		const top = getScroll(sessionKey, activeFilePath);
		if (top != null) ed.setScrollTop(top);
		let raf = 0;
		const sub = ed.onDidScrollChange(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				setScroll(sessionKey, activeFilePath, ed.getScrollTop());
			});
		});
		return () => {
			cancelAnimationFrame(raf);
			sub.dispose();
		};
	}, [editorInstance, sessionKey, activeFilePath, getScroll, setScroll]);

	useEffect(() => {
		const ed = editorInstance?.getModifiedEditor();
		if (!ed || !activeCommentId) return;
		const c = fileComments.find((fc) => fc.id === activeCommentId);
		if (!c?.lineNumber) return;
		ed.revealLineInCenter(c.lineNumber);
	}, [editorInstance, activeCommentId, fileComments]);

	if (!activeFilePath || !selectedGroup) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-[var(--text-tertiary)]">
				Select a file from the sidebar
			</div>
		);
	}

	const shortHash = commitHash ? commitHash.slice(0, 7) : "no commit";
	const isLoading = !!commitHash && (originalQuery.isLoading || modifiedQuery.isLoading);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{activeFilePath}
				</span>
				<span className="font-mono text-[11px] text-[var(--text-quaternary)]">{shortHash}</span>
				<button
					type="button"
					onClick={() => toggleCommentsVisible(sessionKey)}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					title={commentsVisible ? "Hide inline comments" : "Show inline comments"}
				>
					💬 Comments: {commentsVisible ? "On" : "Off"}
				</button>
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					{diffMode === "split" ? "Inline" : "Split"}
				</button>
			</div>
			<div className="flex-1 overflow-hidden">
				{!commitHash ? (
					<div className="h-full overflow-y-auto p-4">
						<div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-tertiary)] mb-[8px]">
							Comments only — no code changes
						</div>
						<div className="flex flex-col gap-1">
							{fileComments.map((c) => (
								<SolveCommentWidget
									key={c.id}
									comment={c}
									workspaceId={workspaceId}
									isActive={c.id === activeCommentId}
								/>
							))}
						</div>
					</div>
				) : isLoading ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Loading…
					</div>
				) : (
					<DiffEditor
						original={originalQuery.data?.content ?? ""}
						modified={modifiedQuery.data?.content ?? ""}
						language={language}
						renderSideBySide={diffMode === "split"}
						readOnly={true}
						onEditorReady={(editor) => setEditorInstance(editor)}
					/>
				)}
			</div>
			<ReviewHintBar hints={SOLVE_HINTS} />
		</div>
	);
}
