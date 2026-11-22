import type * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import type { AskMessage } from "../../../../shared/review-path-types";

type Anchor = NonNullable<AskMessage["anchor"]>;
interface SelectionActionsOptions {
	filePath: string;
	onAsk?: (anchor: Anchor) => void;
	onComment?: (anchor: Anchor) => void;
	onSelection?: (anchor: Anchor | null) => void;
	commentLines?: ReadonlySet<number>;
	originalCommentLines?: ReadonlySet<number>;
	revision?: string;
}

/** One action zone across both editors; focus and model changes invalidate the old anchor. */
export function useSelectionActions(
	editor: monaco.editor.IStandaloneDiffEditor | null,
	options: SelectionActionsOptions
) {
	const canAsk = Boolean(options.onAsk);
	const canComment = Boolean(options.onComment);
	const callbacks = useRef(options);
	callbacks.current = options;
	useEffect(() => {
		if (!editor) return;
		const modified = editor.getModifiedEditor();
		const original = editor.getOriginalEditor?.();
		let owner = modified;
		let zone: string | null = null;
		let lastSelection = "";
		const clear = () => {
			if (zone) {
				owner.changeViewZones((accessor) => {
					if (zone) accessor.removeZone(zone);
				});
				zone = null;
			}
		};
		const reset = () => {
			clear();
			lastSelection = "";
			callbacks.current.onSelection?.(null);
		};
		const update = (source: monaco.editor.IStandaloneCodeEditor, side: "LEFT" | "RIGHT") => {
			const opposite = side === "LEFT" ? modified : original;
			if (opposite?.hasTextFocus?.() && !source.hasTextFocus?.()) return;
			const selection = source.getSelection();
			if (!selection || selection.isEmpty()) {
				clear();
				lastSelection = "";
				callbacks.current.onSelection?.(null);
				return;
			}
			const anchor: Anchor = {
				path: options.filePath,
				side,
				startLine: selection.startLineNumber,
				endLine: selection.endLineNumber,
			};
			const signature = `${options.revision}:${side}:${anchor.startLine}:${anchor.endLine}`;
			if (lastSelection === signature) return;
			lastSelection = signature;
			clear();
			owner = source;
			callbacks.current.onSelection?.(anchor);
			const node = document.createElement("div");
			node.className = "flex items-center gap-2 bg-[var(--bg-base)] px-3 text-[12px]";
			node.style.pointerEvents = "auto";
			node.addEventListener("mousedown", (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			const addButton = (label: string, action: () => void, primary: boolean) => {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = label;
				button.className = primary
					? "rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--accent-foreground)]"
					: "rounded-md border border-[var(--border)] px-3 py-1 text-[var(--text)]";
				button.addEventListener("click", (event) => {
					event.stopPropagation();
					action();
				});
				node.appendChild(button);
			};
			if (canAsk) addButton("Ask agent", () => callbacks.current.onAsk?.(anchor), true);
			const allowed = side === "LEFT" ? options.originalCommentLines : options.commentLines;
			if (canComment && (!allowed || allowed.has(anchor.endLine)))
				addButton("Comment · c", () => callbacks.current.onComment?.(anchor), false);
			owner.changeViewZones((accessor) => {
				zone = accessor.addZone({ afterLineNumber: anchor.endLine, heightInPx: 40, domNode: node });
			});
		};
		const subscriptions: monaco.IDisposable[] = [];
		for (const [source, side] of [
			[original, "LEFT"],
			[modified, "RIGHT"],
		] as const) {
			if (!source) continue;
			subscriptions.push(source.onDidChangeCursorSelection(() => update(source, side)));
			subscriptions.push(source.onDidChangeModel(reset));
			const focus = source.onDidFocusEditorText?.(() => update(source, side));
			if (focus) subscriptions.push(focus);
		}
		return () => {
			for (const subscription of subscriptions) subscription.dispose();
			reset();
		};
	}, [
		editor,
		options.filePath,
		options.commentLines,
		options.originalCommentLines,
		options.revision,
		canAsk,
		canComment,
	]);
}
