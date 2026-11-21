import { join } from "node:path";
const root = process.argv[2];
if (!root) throw new Error("Fixture output required");
const boundaries: Bun.BunPlugin = {
	name: "isolated-snapshot-boundaries",
	setup(build) {
		build.onResolve({ filter: /(?:workspace-cwd-lookup|logger)$/ }, (args) => ({
			path: args.path,
			namespace: "fixture",
		}));
		build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
			loader: "js",
			contents: args.path.endsWith("logger")
				? "export const log = {info(){},warn(){},error(){}};"
				: "export const getWorkspaceCwdOrThrow = () => {throw new Error('Global workspace lookup prohibited');};",
		}));
	},
};
for (const [entry, target, format, name] of [
	["main.ts", "node", "esm", "main.mjs"],
	["preload.ts", "browser", "cjs", "preload.cjs"],
	["renderer.tsx", "browser", "esm", "renderer.js"],
] as const) {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, entry)],
		outdir: root,
		target,
		format,
		naming: name,
		external: ["electron"],
		plugins: [boundaries],
	});
	if (!result.success) throw new Error(result.logs.map(String).join("\n"));
}
