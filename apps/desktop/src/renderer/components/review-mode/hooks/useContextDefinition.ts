import type * as monaco from "monaco-editor";
import { useEffect } from "react";
import { detectLanguage } from "../../../../shared/diff-types";
import type { CodeReference } from "../../../../shared/review-path-types";
import { requestReviewDefinition } from "../../../lsp/monaco-lsp-bridge";
/** Ask the existing LSP server without registering snapshot models as working-tree documents. */
export function useContextDefinition(
	editor: monaco.editor.IStandaloneCodeEditor | null,
	repoPath: string,
	filePath: string | null,
	onOpen?: (ref: CodeReference) => void
) {
	useEffect(() => {
		if (!editor || !filePath || !onOpen) return;
		let cancelled = false;
		const listener = editor.onMouseDown((event) => {
			if (!(event.event.metaKey || event.event.ctrlKey) || !event.target.position) return;
			const model = editor.getModel();
			const position = event.target.position;
			if (!model?.getWordAtPosition(position)) return;
			void requestReviewDefinition(repoPath, filePath, detectLanguage(filePath), position).then(
				(ref) => {
					if (!cancelled && editor.getModel() === model && ref) onOpen(ref);
				}
			);
		});
		return () => {
			cancelled = true;
			listener.dispose();
		};
	}, [editor, repoPath, filePath, onOpen]);
}
