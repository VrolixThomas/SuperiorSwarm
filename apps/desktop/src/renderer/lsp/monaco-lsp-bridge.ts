import * as monaco from "monaco-editor";
import { detectLanguage } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import {
	clearAllModelRepoPaths,
	clearModelRepoPath,
	findRepoPathFromUri,
	getModelRepoPath,
	setModelRepoPath,
} from "./model-repo-map";

export { clearModelRepoPath, setModelRepoPath };

const disposables = new Map<string, monaco.IDisposable[]>();

export function registerLspProviders(languageId: string): void {
	// Avoid double-registering
	if (disposables.has(languageId)) return;

	const toDispose: monaco.IDisposable[] = [];

	// Completion provider
	toDispose.push(
		monaco.languages.registerCompletionItemProvider(languageId, {
			triggerCharacters: [".", "/", "<"],
			provideCompletionItems: async (model, position, context, _token) => {
				const uri = model.uri.toString();
				const repoPath = getModelRepoPath(uri);
				if (!repoPath) return { suggestions: [] };

				const result = await window.electron.lsp.sendRequest({
					languageId,
					repoPath,
					method: "textDocument/completion",
					params: {
						textDocument: { uri },
						position: {
							line: position.lineNumber - 1,
							character: position.column - 1,
						},
						context: {
							triggerKind: context.triggerKind,
							triggerCharacter: context.triggerCharacter,
						},
					},
				});

				if (result.error || !result.result) return { suggestions: [] };

				const items = Array.isArray(result.result)
					? result.result
					: ((result.result as { items?: unknown[] }).items ?? []);

				return {
					// biome-ignore lint/suspicious/noExplicitAny: LSP completion item shape comes from untyped IPC
					suggestions: items.map((item: any) => ({
						label: item.label,
						kind: item.kind ?? monaco.languages.CompletionItemKind.Text,
						insertText: item.insertText ?? item.label,
						insertTextRules:
							item.insertTextFormat === 2
								? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
								: undefined,
						detail: item.detail,
						documentation: item.documentation,
						sortText: item.sortText,
						filterText: item.filterText,
						// biome-ignore lint/suspicious/noExplicitAny: Monaco range type mismatch; inferred from word context
						range: undefined as any, // Monaco will infer from word
					})),
				};
			},
		})
	);

	// Hover provider
	toDispose.push(
		monaco.languages.registerHoverProvider(languageId, {
			provideHover: async (model, position, _token) => {
				const uri = model.uri.toString();
				const repoPath = getModelRepoPath(uri);
				if (!repoPath) return null;

				const result = await window.electron.lsp.sendRequest({
					languageId,
					repoPath,
					method: "textDocument/hover",
					params: {
						textDocument: { uri },
						position: {
							line: position.lineNumber - 1,
							character: position.column - 1,
						},
					},
				});

				if (result.error || !result.result) return null;
				// biome-ignore lint/suspicious/noExplicitAny: LSP hover response shape from untyped IPC
				const hover = result.result as { contents: any; range?: any };

				const contents = Array.isArray(hover.contents)
					? // biome-ignore lint/suspicious/noExplicitAny: LSP MarkedString union from untyped IPC
						hover.contents.map((c: any) =>
							typeof c === "string" ? { value: c } : { value: c.value ?? "" }
						)
					: [
							typeof hover.contents === "string"
								? { value: hover.contents }
								: // biome-ignore lint/suspicious/noExplicitAny: LSP MarkedString union from untyped IPC
									{ value: (hover.contents as any).value ?? "" },
						];

				return { contents };
			},
		})
	);

	// Definition provider
	toDispose.push(
		monaco.languages.registerDefinitionProvider(languageId, {
			provideDefinition: async (model, position, _token) => {
				const uri = model.uri.toString();
				const repoPath = getModelRepoPath(uri);
				if (!repoPath) return null;

				const result = await window.electron.lsp.sendRequest({
					languageId,
					repoPath,
					method: "textDocument/definition",
					params: {
						textDocument: { uri },
						position: {
							line: position.lineNumber - 1,
							character: position.column - 1,
						},
					},
				});

				if (result.error || !result.result) return null;
				return convertLocations(result.result);
			},
		})
	);

	// Reference provider
	toDispose.push(
		monaco.languages.registerReferenceProvider(languageId, {
			provideReferences: async (model, position, context, _token) => {
				const uri = model.uri.toString();
				const repoPath = getModelRepoPath(uri);
				if (!repoPath) return null;

				const result = await window.electron.lsp.sendRequest({
					languageId,
					repoPath,
					method: "textDocument/references",
					params: {
						textDocument: { uri },
						position: {
							line: position.lineNumber - 1,
							character: position.column - 1,
						},
						context: {
							includeDeclaration: context.includeDeclaration,
						},
					},
				});

				if (result.error || !result.result) return null;
				return convertLocations(result.result) as monaco.languages.Location[];
			},
		})
	);

	disposables.set(languageId, toDispose);
}

function convertLocations(result: unknown): monaco.languages.Location[] | null {
	if (!result) return null;
	const locations = Array.isArray(result) ? result : [result];
	// biome-ignore lint/suspicious/noExplicitAny: LSP Location/LocationLink shape from untyped IPC
	return locations.map((loc: any) => ({
		uri: monaco.Uri.parse(loc.uri ?? loc.targetUri),
		range: convertRange(loc.range ?? loc.targetRange),
	}));
}

// biome-ignore lint/suspicious/noExplicitAny: LSP Range shape from untyped IPC
function convertRange(range: any): monaco.IRange {
	if (!range)
		return {
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: 1,
			endColumn: 1,
		};
	return {
		startLineNumber: range.start.line + 1,
		startColumn: range.start.character + 1,
		endLineNumber: range.end.line + 1,
		endColumn: range.end.character + 1,
	};
}

// Document synchronization

export function sendDidOpen(
	repoPath: string,
	languageId: string,
	uri: string,
	content: string,
	version = 1
): void {
	window.electron.lsp.sendNotification({
		languageId,
		repoPath,
		method: "textDocument/didOpen",
		params: {
			textDocument: { uri, languageId, version, text: content },
		},
	});
}

export function sendDidChange(
	repoPath: string,
	languageId: string,
	uri: string,
	content: string,
	version: number
): void {
	window.electron.lsp.sendNotification({
		languageId,
		repoPath,
		method: "textDocument/didChange",
		params: {
			textDocument: { uri, version },
			contentChanges: [{ text: content }],
		},
	});
}

export function sendDidClose(repoPath: string, languageId: string, uri: string): void {
	window.electron.lsp.sendNotification({
		languageId,
		repoPath,
		method: "textDocument/didClose",
		params: {
			textDocument: { uri },
		},
	});
}

export function setupGoToDefinitionHandler(): () => void {
	// Monaco's built-in go-to-definition already works for same-file navigation.
	// For cross-file, we use the public registerEditorOpener API to open new tabs.
	const disposable = monaco.editor.registerEditorOpener({
		openCodeEditor(_source, resource, selectionOrPosition) {
			const uri = resource.toString();
			if (!uri.startsWith("file://")) return false;

			const repoPath = getModelRepoPath(uri) ?? findRepoPathFromUri(uri);
			if (!repoPath) return false;

			const filePath = uri.replace(`file://${repoPath}/`, "");
			const language = detectLanguage(filePath);

			let position: { lineNumber: number; column: number } | undefined;
			if (selectionOrPosition) {
				if ("startLineNumber" in selectionOrPosition) {
					position = {
						lineNumber: selectionOrPosition.startLineNumber,
						column: selectionOrPosition.startColumn,
					};
				} else {
					position = {
						lineNumber: selectionOrPosition.lineNumber,
						column: selectionOrPosition.column,
					};
				}
			}

			const workspaceId = useTabStore.getState().activeWorkspaceId;
			if (!workspaceId) return false;

			useTabStore.getState().openFile(workspaceId, repoPath, filePath, language, position);
			return true;
		},
	});
	return () => disposable.dispose();
}

export function disposeProviders(languageId: string): void {
	const toDispose = disposables.get(languageId);
	if (toDispose) {
		for (const d of toDispose) d.dispose();
		disposables.delete(languageId);
	}
}

let diagnosticsCleanup: (() => void) | null = null;

export function setupDiagnosticsListener(): void {
	if (diagnosticsCleanup) return;

	diagnosticsCleanup = window.electron.lsp.onNotification((_serverId, method, params) => {
		if (method !== "textDocument/publishDiagnostics") return;
		const { uri, diagnostics } = params as {
			uri: string;
			diagnostics: Array<{
				range: {
					start: { line: number; character: number };
					end: { line: number; character: number };
				};
				message: string;
				severity?: number;
				source?: string;
				code?: number | string;
			}>;
		};

		const modelUri = monaco.Uri.parse(uri);
		const model = monaco.editor.getModel(modelUri);
		if (!model) return;

		const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
			startLineNumber: d.range.start.line + 1,
			startColumn: d.range.start.character + 1,
			endLineNumber: d.range.end.line + 1,
			endColumn: d.range.end.character + 1,
			message: d.message,
			severity: convertSeverity(d.severity),
			source: d.source,
			code: d.code?.toString(),
		}));

		monaco.editor.setModelMarkers(model, "lsp", markers);
	});
}

function convertSeverity(severity?: number): monaco.MarkerSeverity {
	switch (severity) {
		case 1:
			return monaco.MarkerSeverity.Error;
		case 2:
			return monaco.MarkerSeverity.Warning;
		case 3:
			return monaco.MarkerSeverity.Info;
		case 4:
			return monaco.MarkerSeverity.Hint;
		default:
			return monaco.MarkerSeverity.Error;
	}
}

export function setupServerRestartListener(): () => void {
	return window.electron.lsp.onServerRestarted((_configId, repoPath, uris) => {
		for (const uri of uris) {
			const model = monaco.editor.getModel(monaco.Uri.parse(uri));
			if (!model) continue;
			const languageId = model.getLanguageId();
			sendDidOpen(repoPath, languageId, uri, model.getValue());
		}
	});
}

export function disposeAllProviders(): void {
	for (const [, toDispose] of disposables) {
		for (const d of toDispose) d.dispose();
	}
	disposables.clear();
	clearAllModelRepoPaths();
	if (diagnosticsCleanup) {
		diagnosticsCleanup();
		diagnosticsCleanup = null;
	}
}
