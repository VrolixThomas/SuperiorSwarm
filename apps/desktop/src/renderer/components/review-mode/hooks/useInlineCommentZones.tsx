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
	inner: HTMLElement;
	root: Root;
	ro: ResizeObserver;
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

function makeZoneNode(): { domNode: HTMLElement; inner: HTMLElement } {
	const domNode = document.createElement("div");
	domNode.style.pointerEvents = "auto";
	domNode.style.zIndex = "10";
	domNode.style.width = "100%";
	domNode.style.overflow = "hidden";
	domNode.addEventListener("mousedown", (e) => e.stopPropagation());
	domNode.addEventListener("keydown", (e) => e.stopPropagation());
	const inner = document.createElement("div");
	domNode.appendChild(inner);
	return { domNode, inner };
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

	for (const entry of entries) entry.ro.disconnect();

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
			<div className="mb-1.5 text-[11px] font-medium text-[var(--text-tertiary)]">Line {line}</div>
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
 * in-progress state. Zone height is measured via ResizeObserver against the
 * rendered content rather than estimated from character counts, so markdown
 * (fenced code blocks, lists, etc.) never overflows its view zone.
 */
export function useInlineCommentZones(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	threads: UnifiedThread[],
	pendingLine: number | null,
	renderThread: (thread: UnifiedThread) => ReactNode,
	onSaveNew: (body: string) => void,
	onCancelNew: () => void
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

		// Guards against layout feedback loops: only re-layout the zone when the
		// measured content height actually maps to a different line count.
		const resizeZone = (entry: ZoneEntry, line: number) => {
			const contentPx = entry.inner.offsetHeight;
			if (contentPx === 0) return;
			const heightInLines = Math.max(1, Math.ceil(contentPx / lineHeight));
			if (heightInLines === entry.heightInLines) return;
			modEditor.changeViewZones((acc) => {
				acc.removeZone(entry.zoneId);
				entry.zoneId = acc.addZone({
					afterLineNumber: line,
					heightInLines,
					domNode: entry.domNode,
				});
				entry.heightInLines = heightInLines;
			});
		};

		const resizePendingZone = () => {
			const entry = pendingZoneRef.current;
			if (!entry) return;
			resizeZone(entry, entry.line);
		};

		modEditor.changeViewZones((acc) => {
			// Remove zones whose line no longer has threads.
			for (const [line, entry] of zonesRef.current) {
				if (!byLine.has(line)) {
					acc.removeZone(entry.zoneId);
					entry.ro.disconnect();
					const root = entry.root;
					queueMicrotask(() => root.unmount());
					zonesRef.current.delete(line);
				}
			}

			// Add new / update existing.
			for (const [line, lineThreads] of byLine) {
				const sig = `${renderVersionRef.current}\u001d${lineThreads.map(threadSignature).join("\u001e")}`;
				const existing = zonesRef.current.get(line);

				if (!existing) {
					const { domNode, inner } = makeZoneNode();
					const heightInLines = 4;
					const zoneId = acc.addZone({ afterLineNumber: line, heightInLines, domNode });
					const root = createRoot(inner);
					const ro = new ResizeObserver(() => {
						const current = zonesRef.current.get(line);
						if (current) resizeZone(current, line);
					});
					ro.observe(inner);
					const entry: ZoneEntry = {
						zoneId,
						domNode,
						inner,
						root,
						ro,
						heightInLines,
						signature: sig,
					};
					zonesRef.current.set(line, entry);
					renderLine(lineThreads, entry);
					continue;
				}

				if (existing.signature !== sig) {
					renderLine(lineThreads, existing);
					existing.signature = sig;
				}
			}

			// Pending new-thread zone — at most one.
			const pending = pendingZoneRef.current;
			if (pendingLine === null) {
				if (pending) {
					acc.removeZone(pending.zoneId);
					pending.ro.disconnect();
					const root = pending.root;
					queueMicrotask(() => root.unmount());
					pendingZoneRef.current = null;
				}
			} else if (!pending || pending.line !== pendingLine) {
				if (pending) {
					acc.removeZone(pending.zoneId);
					pending.ro.disconnect();
					const root = pending.root;
					queueMicrotask(() => root.unmount());
				}
				const { domNode, inner } = makeZoneNode();
				const heightInLines = Math.ceil(120 / lineHeight);
				const zoneId = acc.addZone({ afterLineNumber: pendingLine, heightInLines, domNode });
				const root = createRoot(inner);
				root.render(
					<NewThreadWidget line={pendingLine} onSave={onSaveNew} onCancel={onCancelNew} />
				);
				const ro = new ResizeObserver(() => resizePendingZone());
				ro.observe(inner);
				pendingZoneRef.current = {
					zoneId,
					domNode,
					inner,
					root,
					ro,
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
	}, [editor, threads, pendingLine, renderThread, onSaveNew, onCancelNew]);

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
