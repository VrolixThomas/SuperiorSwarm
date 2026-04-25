import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import { useThemeStore } from "./stores/theme-store";
import { trpc } from "./trpc/client";
import { ipcLink } from "./trpc/ipc-link";

// Monaco web workers — required for language features (syntax, validation, etc.)
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Eager-load monarch grammars. Monaco lazy-loads these via dynamic import by
// default, which is unreliable in the Electron renderer — the chunk resolves
// silently to nothing and the file renders as plaintext.
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.js";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.js";
import "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.js";
import "monaco-editor/esm/vs/basic-languages/php/php.js";
import "monaco-editor/esm/vs/basic-languages/scala/scala.js";
import "monaco-editor/esm/vs/basic-languages/swift/swift.js";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.js";
import "monaco-editor/esm/vs/basic-languages/lua/lua.js";
import "monaco-editor/esm/vs/basic-languages/r/r.js";
import "monaco-editor/esm/vs/basic-languages/dart/dart.js";
import "monaco-editor/esm/vs/basic-languages/elixir/elixir.js";

self.MonacoEnvironment = {
	getWorker(_workerId: string, label: string) {
		if (label === "typescript" || label === "javascript") return new tsWorker();
		if (label === "json") return new jsonWorker();
		if (label === "css" || label === "scss" || label === "less") return new cssWorker();
		if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
		return new editorWorker();
	},
};

// Disable Monaco's built-in TypeScript/JavaScript diagnostics — they use default
// compiler options (no tsconfig.json awareness) and produce false positives.
// Real diagnostics come from the LSP language server instead.
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
	noSemanticValidation: true,
	noSyntaxValidation: true,
});
monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
	noSemanticValidation: true,
	noSyntaxValidation: true,
});

// Fire-and-forget hydration — first-paint script handles immediate paint;
// hydrate updates the store + reapplies the canonical pref from DB.
useThemeStore.getState().hydrate();

function Root() {
	const [queryClient] = useState(() => new QueryClient());
	const [trpcClient] = useState(() =>
		trpc.createClient({
			links: [ipcLink()],
		})
	);

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</trpc.Provider>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
	<StrictMode>
		<ErrorBoundary>
			<Root />
		</ErrorBoundary>
	</StrictMode>
);
