import { join } from "node:path";
const root = process.argv[2];
if (!root) throw Error("Fixture output required");
for (const [entry, target, format, name] of [
	["main.ts", "node", "cjs", "main.cjs"],
	["preload.ts", "browser", "cjs", "preload.cjs"],
	["renderer.tsx", "browser", "esm", "renderer.js"],
] as const) {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, entry)],
		outdir: root,
		target,
		format,
		naming: name,
		external: ["electron", "node-pty", "better-sqlite3"],
		define: { __dirname: JSON.stringify(root), "import.meta.env": JSON.stringify({ DEV: true }) },
	});
	if (!result.success) throw Error(result.logs.map(String).join("\n"));
}
