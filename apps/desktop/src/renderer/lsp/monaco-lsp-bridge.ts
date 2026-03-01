import * as monaco from "monaco-editor";

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
				const repoPath = extractRepoPath(uri);
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
				const repoPath = extractRepoPath(uri);
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
				const hover = result.result as { contents: any; range?: any };

				const contents = Array.isArray(hover.contents)
					? hover.contents.map((c: any) =>
							typeof c === "string" ? { value: c } : { value: c.value ?? "" }
						)
					: [
							typeof hover.contents === "string"
								? { value: hover.contents }
								: { value: (hover.contents as any).value ?? "" },
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
				const repoPath = extractRepoPath(uri);
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
				const repoPath = extractRepoPath(uri);
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
	return locations.map((loc: any) => ({
		uri: monaco.Uri.parse(loc.uri ?? loc.targetUri),
		range: convertRange(loc.range ?? loc.targetRange),
	}));
}

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

// Repo path is stored as a custom property on the model URI.
// We use a map to track which model URIs belong to which repo.
const modelRepoMap = new Map<string, string>();

export function setModelRepoPath(modelUri: string, repoPath: string): void {
	modelRepoMap.set(modelUri, repoPath);
}

function extractRepoPath(modelUri: string): string | null {
	return modelRepoMap.get(modelUri) ?? null;
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

export function disposeProviders(languageId: string): void {
	const toDispose = disposables.get(languageId);
	if (toDispose) {
		for (const d of toDispose) d.dispose();
		disposables.delete(languageId);
	}
}

export function disposeAllProviders(): void {
	for (const [, toDispose] of disposables) {
		for (const d of toDispose) d.dispose();
	}
	disposables.clear();
	modelRepoMap.clear();
}
