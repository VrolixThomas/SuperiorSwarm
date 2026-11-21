import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
const root = process.argv[2]!;
const boundary: Bun.BunPlugin = {
	name: "isolated-native-boundary",
	setup(build) {
		build.onResolve({ filter: /^monaco-editor\/esm\/vs\/editor\/editor.api$/ }, () => ({
			path: require.resolve("monaco-editor/esm/vs/editor/editor.api.js"),
		}));
		build.onResolve({ filter: /(?:workspace-cwd-lookup|logger)$/ }, (args) => ({
			path: args.path,
			namespace: "fixture",
		}));
		build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
			loader: "js",
			contents: args.path.endsWith("logger")
				? "export const log={info(){},warn(){},error(){}}"
				: "export const getWorkspaceCwdOrThrow=()=>{throw Error('Global workspace lookup prohibited')}",
		}));
	},
};
for (const [entry, target, format, naming] of [
	["main.ts", "node", "esm", "main.mjs"],
	["preload.ts", "browser", "cjs", "preload.cjs"],
	["renderer.tsx", "browser", "esm", "renderer.[ext]"],
] as const) {
	const r = await Bun.build({
		entrypoints: [join(import.meta.dir, entry)],
		outdir: root,
		target,
		format,
		naming,
		external: ["electron"],
		plugins: [boundary],
		define: { "process.env.NODE_ENV": '"production"' },
	});
	if (!r.success) throw Error(r.logs.map(String).join("\n"));
}
for (const [entry, name] of [
	["monaco-editor/esm/vs/editor/editor.worker.js", "editor-worker.js"],
	["monaco-editor/esm/vs/language/typescript/ts.worker.js", "ts-worker.js"],
]) {
	const r = await Bun.build({
		entrypoints: [require.resolve(entry!)],
		outdir: root,
		target: "browser",
		format: "esm",
		naming: name!,
	});
	if (!r.success) throw Error(r.logs.map(String).join("\n"));
}
const cssPath = resolve(import.meta.dir, "../../../src/renderer/styles.css");
const css = await postcss([tailwind({ base: resolve(import.meta.dir, "../../..") })]).process(
	readFileSync(cssPath, "utf8"),
	{ from: cssPath }
);
writeFileSync(join(root, "app.css"), css.css);
writeFileSync(
	join(root, "index.html"),
	'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="renderer.js"></script>'
);
