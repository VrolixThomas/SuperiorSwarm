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
import { trpc } from "../../trpc/client";

export interface UseFileEditorLspResult {
	message: string | null;
	/** Truthy only when the current message is about untrusted repo trust. */
	canTrust: boolean;
	/** Call from UI to trust the current repo. No-op if not applicable. */
	trustRepo: () => Promise<void>;
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
	const [canTrust, setCanTrust] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);
	const setRepoTrust = trpc.lsp.setRepoTrust.useMutation();
	const utils = trpc.useUtils();
	const stateRef = useRef({
		enabled: false,
		uri: "",
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an intentional trigger to re-run the support check after trusting the repo
	useEffect(() => {
		if (!model) {
			stateRef.current = { enabled: false, uri: "" };
			setMessage(null);
			setCanTrust(false);
			return;
		}
		const uri = model.uri.toString();
		stateRef.current = { enabled: false, uri };
		let disposed = false;

		void (async () => {
			try {
				setMessage(null);
				setCanTrust(false);
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
						setCanTrust(false);
					} else if (support.reason === "untrusted-repo") {
						setMessage(
							"This repository ships its own LSP config in .superiorswarm/lsp.json. Trust it to enable those servers."
						);
						setCanTrust(true);
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
	}, [model, repoPath, language, filePath, refreshKey]);

	const trustRepo = useCallback(async () => {
		const normalized = repoPath?.trim();
		if (!normalized) return;
		await setRepoTrust.mutateAsync({ repoPath: normalized, trusted: true });
		await utils.lsp.getRepoTrust.invalidate();
		setRefreshKey((k) => k + 1);
	}, [repoPath, setRepoTrust, utils]);

	const onContentChanged = useCallback(
		(version: number) => {
			if (!stateRef.current.enabled || !model) return;
			sendDidChange(repoPath, language, stateRef.current.uri, model.getValue(), version);
		},
		[model, repoPath, language]
	);

	return { message, canTrust, trustRepo, onContentChanged };
}
