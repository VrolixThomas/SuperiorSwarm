import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const directory = dirname(fileURLToPath(import.meta.url));
await build({
	configFile: false,
	root: resolve(directory, "../../src/renderer"),
	plugins: [react()],
	resolve: {
		alias: {
			"@": resolve(directory, "../../src/renderer"),
			"monaco-editor/esm/vs/editor/editor.api": resolve(
				directory,
				"../../node_modules/monaco-editor/esm/vs/editor/editor.api.js"
			),
		},
	},
	define: {
		"process.env.NODE_ENV": JSON.stringify(process.env.BROWSER_TEST_REACT_MODE ?? "production"),
	},
	build: {
		outDir: process.argv[2],
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(directory, "workspace-browser-app-renderer.tsx"),
			formats: ["es"],
			fileName: () => "renderer.js",
		},
		rollupOptions: { output: { inlineDynamicImports: true } },
	},
});
