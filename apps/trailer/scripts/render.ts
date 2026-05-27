import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.resolve(projectRoot, "../../launchcontent/videos");

interface Target {
	id: string;
	output: string;
	videoBitrate?: `${number}M` | `${number}K` | `${number}k`;
	audioBitrate: `${number}M` | `${number}K` | `${number}k`;
	crf?: number;
	x264Preset?: "ultrafast" | "fast" | "medium" | "slow" | "veryslow";
}

type TargetKey = "v2" | "v3" | "v4" | "short";

const TARGETS: Record<TargetKey, Target> = {
	v2: {
		id: "HeroBuildV2",
		output: "hero-build-v2.mp4",
		videoBitrate: "8M",
		audioBitrate: "192k",
	},
	v3: {
		id: "HeroBuildV3",
		output: "hero-build-v3.mp4",
		videoBitrate: "10M",
		audioBitrate: "192k",
	},
	v4: {
		id: "HeroBuildV4",
		output: "hero-build-v4.mp4",
		videoBitrate: "10M",
		audioBitrate: "192k",
	},
	short: {
		id: "HeroBuildShortV1",
		output: "hero-build-short-v1.mp4",
		// CRF mode + slow preset → crisper text/UI edges than fixed bitrate.
		crf: 17,
		x264Preset: "slow",
		audioBitrate: "192k",
	},
};

async function renderOne(target: Target, serveUrl: string) {
	console.log(`[trailer] selecting composition ${target.id}…`);
	const composition = await selectComposition({ serveUrl, id: target.id });

	const outputPath = path.join(outputDir, target.output);
	const qualityLabel = target.crf != null ? `crf ${target.crf}` : (target.videoBitrate ?? "?");
	console.log(`[trailer] rendering → ${outputPath} @ ${qualityLabel}`);
	await renderMedia({
		composition,
		serveUrl,
		codec: "h264",
		outputLocation: outputPath,
		...(target.crf != null
			? { crf: target.crf, x264Preset: target.x264Preset ?? "medium" }
			: { videoBitrate: target.videoBitrate }),
		audioBitrate: target.audioBitrate,
		onProgress: ({ progress }) => {
			if (progress % 0.05 < 0.01) {
				console.log(`[trailer]   ${target.id} ${Math.round(progress * 100)}%`);
			}
		},
	});
	console.log(`[trailer] ✓ wrote ${target.output}`);
}

async function main() {
	const arg = process.argv[2] ?? "all";
	const which: TargetKey[] =
		arg === "v2"
			? ["v2"]
			: arg === "v3"
				? ["v3"]
				: arg === "v4"
					? ["v4"]
					: arg === "short"
						? ["short"]
						: arg === "all"
							? ["v2", "v3", "v4"]
							: ["v2", "v3", "v4"];

	console.log("[trailer] bundling…");
	const serveUrl = await bundle({
		entryPoint: path.resolve(projectRoot, "src/index.ts"),
		webpackOverride: (config) => enableTailwind(config),
	});

	for (const k of which) {
		await renderOne(TARGETS[k], serveUrl);
	}
}

main().catch((err) => {
	console.error("[trailer] render failed:", err);
	process.exit(1);
});
