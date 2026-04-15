import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	clearModelRepoPath,
	registerLspProviders,
	sendDidChange,
	sendDidClose,
	sendDidOpen,
	setModelRepoPath,
} from "../../lsp/monaco-lsp-bridge";

export interface UseFileEditorLspResult {
	message: string | null;
	/** Call from onDidChangeContent with the new document version. */
	onContentChanged: (version: number) => void;
}

export function useFileEditorLsp(
	model: monaco.editor.ITextModel | null,
	repoPath: string,
	language: string,
	filePath: string
): UseFileEditorLspResult {
	const [message, setMessage] = useState<string | null>(null);
	const stateRef = useRef({
		enabled: false,
		uri: "",
	});

	useEffect(() => {
		if (!model) {
			stateRef.current = { enabled: false, uri: "" };
			setMessage(null);
			return;
		}
		const uri = model.uri.toString();
		stateRef.current = { enabled: false, uri };
		let disposed = false;

		void (async () => {
			try {
				setMessage(null);
				const support = await window.electron.lsp.getSupport({
					repoPath,
					languageId: language,
					filePath,
				});
				if (disposed) return;
				if (!support.supported) {
					if (support.reason === "missing-binary") {
						setMessage(
							`Language server executable not found for ${language}. Editing still works without LSP features.`
						);
					} else if (support.reason === "untrusted-repo") {
						setMessage(
							"This repository ships its own LSP config in .superiorswarm/lsp.json, but the repo is not trusted. Open Settings → Language Servers to review and trust it."
						);
					}
					return;
				}
				stateRef.current.enabled = true;
				setModelRepoPath(uri, repoPath);
				registerLspProviders(language);
				sendDidOpen(repoPath, language, uri, model.getValue(), 1);
			} catch {
				// Fall back to non-LSP editing.
			}
		})();

		return () => {
			disposed = true;
			if (stateRef.current.enabled) {
				sendDidClose(repoPath, language, uri);
			}
			clearModelRepoPath(uri);
		};
	}, [model, repoPath, language, filePath]);

	const onContentChanged = useCallback(
		(version: number) => {
			if (!stateRef.current.enabled || !model) return;
			sendDidChange(repoPath, language, stateRef.current.uri, model.getValue(), version);
		},
		[model, repoPath, language]
	);

	return { message, onContentChanged };
}
