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
}

/** A single disposable view zone, tied to the modified model and current file. */
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
		let zone: string | null = null;
		let lastSelection = "";
		const clear = () => {
			if (zone) {
				modified.changeViewZones((accessor) => {
					if (zone) accessor.removeZone(zone);
				});
				zone = null;
			}
		};
		const update = () => {
			const selection = modified.getSelection();
			if (!selection || selection.isEmpty()) {
				clear();
				lastSelection = "";
				callbacks.current.onSelection?.(null);
				return;
			}
			const anchor: Anchor = {
				path: options.filePath,
				side: "RIGHT",
				startLine: selection.startLineNumber,
				endLine: selection.endLineNumber,
			};
			const signature = `${anchor.startLine}:${anchor.endLine}`;
			if (lastSelection === signature) return;
			lastSelection = signature;
			clear();
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
			if (canComment && (!options.commentLines || options.commentLines.has(anchor.endLine)))
				addButton("Comment · c", () => callbacks.current.onComment?.(anchor), false);
			modified.changeViewZones((accessor) => {
				zone = accessor.addZone({ afterLineNumber: anchor.endLine, heightInPx: 40, domNode: node });
			});
		};
		const selectionSubscription = modified.onDidChangeCursorSelection(update);
		const modelSubscription = modified.onDidChangeModel(() => {
			clear();
			lastSelection = "";
			callbacks.current.onSelection?.(null);
		});
		return () => {
			selectionSubscription.dispose();
			modelSubscription.dispose();
			clear();
			callbacks.current.onSelection?.(null);
		};
	}, [editor, options.filePath, options.commentLines, canAsk, canComment]);
}
