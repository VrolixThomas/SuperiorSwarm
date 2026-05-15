import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.resolve(projectRoot, "../../launchcontent/videos");

async function renderOne(compositionId: string, outputFile: string) {
	console.log(`[trailer] bundling for ${compositionId}…`);
	const serveUrl = await bundle({
		entryPoint: path.resolve(projectRoot, "src/index.ts"),
		webpackOverride: (config) => enableTailwind(config),
	});

	console.log(`[trailer] selecting composition ${compositionId}…`);
	const composition = await selectComposition({
		serveUrl,
		id: compositionId,
	});

	const outputPath = path.join(outputDir, outputFile);
	console.log(`[trailer] rendering → ${outputPath}`);
	await renderMedia({
		composition,
		serveUrl,
		codec: "h264",
		outputLocation: outputPath,
		onProgress: ({ progress }) => {
			if (progress % 0.05 < 0.01) {
				console.log(`[trailer]   ${Math.round(progress * 100)}%`);
			}
		},
	});
	console.log(`[trailer] ✓ wrote ${outputFile}`);
}

async function main() {
	await renderOne("HeroBuildV2", "hero-build-v2.mp4");
}

main().catch((err) => {
	console.error("[trailer] render failed:", err);
	process.exit(1);
});
