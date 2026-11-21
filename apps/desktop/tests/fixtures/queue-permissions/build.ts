const entry = process.argv[2];
if (!entry || !process.argv[3]) throw Error("Entry and output directory required");
const result = await Bun.build({
	entrypoints: [entry],
	outdir: process.argv[3],
	target: "node",
	plugins: [
		{
			name: "logger",
			setup(b) {
				b.onResolve({ filter: /^\.\.\/logger$/ }, () => ({ path: "logger", namespace: "logger" }));
				b.onLoad({ filter: /.*/, namespace: "logger" }, () => ({
					contents: "export const log={info(){},warn(){},error(){}}",
					loader: "js",
				}));
			},
		},
	],
});
if (!result.success) throw Error(result.logs.map(String).join("\n"));
