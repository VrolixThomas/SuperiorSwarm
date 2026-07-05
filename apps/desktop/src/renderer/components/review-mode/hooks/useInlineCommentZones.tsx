import * as monaco from "monaco-editor";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import type {
	AIDraftThread,
	GitHubReviewThread,
	UnifiedThread,
} from "../../../../shared/github-types";
import { ReplyComposer } from "../thread/ReplyComposer";

interface ZoneEntry {
	zoneId: string;
	domNode: HTMLElement;
	root: Root;
	heightInLines: number;
	signature: string;
}

function threadSignature(t: UnifiedThread): string {
	if (t.isAIDraft) {
		const ai = t as AIDraftThread;
		return `ai|${ai.id}|${ai.line}|${ai.status}|${ai.body}|${ai.userEdit ?? ""}`;
	}
	const gh = t as GitHubReviewThread;
	const comments = gh.comments.map((c) => `${c.id}:${c.body}`).join("\u001f");
	return `gh|${gh.id}|${gh.line}|${gh.isResolved ? 1 : 0}|${comments}`;
}

function estimateBodyHeight(text: string): number {
	const lines = Math.max(1, Math.ceil(text.length / 60));
	return lines * 16 + 12;
}

function estimateZonePx(threads: UnifiedThread[]): number {
	return threads.reduce((sum, t) => {
		if (t.isAIDraft) {
			const ai = t as AIDraftThread;
			const bodyH = estimateBodyHeight(ai.userEdit ?? ai.body);
			return sum + 32 + bodyH + (ai.status === "pending" ? 36 : 24);
		}
		const gh = t as GitHubReviewThread;
		const commentsH = gh.comments.reduce((s, c) => s + 24 + estimateBodyHeight(c.body), 0);
		return sum + 32 + commentsH + 36;
	}, 0);
}

function makeZoneNode(): HTMLElement {
	const domNode = document.createElement("div");
	domNode.style.pointerEvents = "auto";
	domNode.style.zIndex = "10";
	domNode.style.width = "100%";
	domNode.addEventListener("mousedown", (e) => e.stopPropagation());
	domNode.addEventListener("keydown", (e) => e.stopPropagation());
	return domNode;
}

function disposeZones(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	entries: ZoneEntry[]
): void {
	if (entries.length === 0) return;

	if (editor) {
		try {
			const modEditor = editor.getModifiedEditor();
			modEditor.changeViewZones((acc) => {
				for (const entry of entries) acc.removeZone(entry.zoneId);
			});
		} catch {
			// The editor may already be disposed during file switches; roots still need unmounting.
		}
	}

	queueMicrotask(() => {
		for (const entry of entries) entry.root.unmount();
	});
}

function NewThreadWidget({
	line,
	onSave,
	onCancel,
}: {
	line: number;
	onSave: (body: string) => void;
	onCancel: () => void;
}) {
	return (
		<div className="mx-2 my-1 rounded-[6px] border border-[var(--accent)] bg-[var(--bg-surface)] p-2 text-[11px] shadow-lg">
			<div className="mb-1.5 text-[10px] font-medium text-[var(--text-tertiary)]">Line {line}</div>
			<ReplyComposer
				placeholder="Write a comment..."
				ariaLabel="New comment"
				submitLabel="Add comment"
				autoFocus
				onSubmit={onSave}
				onCancel={onCancel}
			/>
		</div>
	);
}

/**
 * Diff-based view-zone manager. Maintains a per-line zone registry and only
 * touches Monaco/React for zones that actually changed. Background refetches
 * that produce structurally-equivalent threads cause zero churn; partial
 * updates re-render only the affected line so sibling textareas keep their
 * in-progress state.
 */
export function useInlineCommentZones(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	threads: UnifiedThread[],
	pendingLine: number | null,
	renderThread: (thread: UnifiedThread) => ReactNode,
	onSaveNew: (body: string) => void,
	onCancelNew: () => void,
	estimateThreadsHeightPx: (threads: UnifiedThread[]) => number = estimateZonePx
): void {
	const zonesRef = useRef<Map<number, ZoneEntry>>(new Map());
	const pendingZoneRef = useRef<(ZoneEntry & { line: number }) | null>(null);
	const lastEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
	const renderThreadRef = useRef(renderThread);
	const renderVersionRef = useRef(0);

	useEffect(() => {
		if (renderThreadRef.current !== renderThread) {
			renderThreadRef.current = renderThread;
			renderVersionRef.current += 1;
		}
		const previousEditor = lastEditorRef.current;
		if (previousEditor && previousEditor !== editor) {
			const entries = [...zonesRef.current.values()];
			if (pendingZoneRef.current) entries.push(pendingZoneRef.current);
			disposeZones(previousEditor, entries);
			zonesRef.current.clear();
			pendingZoneRef.current = null;
			lastEditorRef.current = null;
		}
		if (!editor) return;

		lastEditorRef.current = editor;

		const modEditor = editor.getModifiedEditor();
		const lineHeight = modEditor.getOption(monaco.editor.EditorOption.lineHeight);

		const byLine = new Map<number, UnifiedThread[]>();
		for (const t of threads) {
			if (t.line == null) continue;
			const arr = byLine.get(t.line) ?? [];
			arr.push(t);
			byLine.set(t.line, arr);
		}

		const renderLine = (lineThreads: UnifiedThread[], entry: ZoneEntry) => {
			entry.root.render(
				<div className="flex flex-col gap-0.5">
					{lineThreads.map((thread) => (
						<Fragment key={thread.id}>{renderThread(thread)}</Fragment>
					))}
				</div>
			);
		};

		modEditor.changeViewZones((acc) => {
			// Remove zones whose line no longer has threads.
			for (const [line, entry] of zonesRef.current) {
				if (!byLine.has(line)) {
					acc.removeZone(entry.zoneId);
					const root = entry.root;
					queueMicrotask(() => root.unmount());
					zonesRef.current.delete(line);
				}
			}

			// Add new / update existing.
			for (const [line, lineThreads] of byLine) {
				const sig = `${renderVersionRef.current}\u001d${lineThreads.map(threadSignature).join("\u001e")}`;
				const heightInLines = Math.ceil(estimateThreadsHeightPx(lineThreads) / lineHeight);
				const existing = zonesRef.current.get(line);

				if (!existing) {
					const domNode = makeZoneNode();
					const zoneId = acc.addZone({ afterLineNumber: line, heightInLines, domNode });
					const root = createRoot(domNode);
					const entry: ZoneEntry = { zoneId, domNode, root, heightInLines, signature: sig };
					zonesRef.current.set(line, entry);
					renderLine(lineThreads, entry);
					continue;
				}

				if (existing.signature === sig && existing.heightInLines === heightInLines) {
					continue;
				}

				if (existing.signature !== sig) {
					renderLine(lineThreads, existing);
					existing.signature = sig;
				}

				if (existing.heightInLines !== heightInLines) {
					// Re-add with new height; same DOM node + React root are reparented, so
					// component state (in-progress textarea, etc.) survives.
					acc.removeZone(existing.zoneId);
					existing.zoneId = acc.addZone({
						afterLineNumber: line,
						heightInLines,
						domNode: existing.domNode,
					});
					existing.heightInLines = heightInLines;
				}
			}

			// Pending new-thread zone — at most one.
			const pending = pendingZoneRef.current;
			if (pendingLine === null) {
				if (pending) {
					acc.removeZone(pending.zoneId);
					const root = pending.root;
					queueMicrotask(() => root.unmount());
					pendingZoneRef.current = null;
				}
			} else if (!pending || pending.line !== pendingLine) {
				if (pending) {
					acc.removeZone(pending.zoneId);
					const root = pending.root;
					queueMicrotask(() => root.unmount());
				}
				const domNode = makeZoneNode();
				const heightInLines = Math.ceil(120 / lineHeight);
				const zoneId = acc.addZone({ afterLineNumber: pendingLine, heightInLines, domNode });
				const root = createRoot(domNode);
				root.render(
					<NewThreadWidget line={pendingLine} onSave={onSaveNew} onCancel={onCancelNew} />
				);
				pendingZoneRef.current = {
					zoneId,
					domNode,
					root,
					heightInLines,
					signature: "",
					line: pendingLine,
				};
			} else {
				// Same pending line — refresh callbacks via re-render (cheap, in-place).
				pending.root.render(
					<NewThreadWidget line={pendingLine} onSave={onSaveNew} onCancel={onCancelNew} />
				);
			}
		});
	}, [editor, threads, pendingLine, renderThread, onSaveNew, onCancelNew, estimateThreadsHeightPx]);

	useEffect(() => {
		// Final teardown when the component unmounts. The captured editor is the
		// one zones were last attached to; if the editor was swapped we already
		// dropped our refs above and this becomes a no-op.
		return () => {
			const ed = lastEditorRef.current;
			const entries = [...zonesRef.current.values()];
			if (pendingZoneRef.current) entries.push(pendingZoneRef.current);
			disposeZones(ed, entries);
			zonesRef.current.clear();
			pendingZoneRef.current = null;
			lastEditorRef.current = null;
		};
	}, []);
}
