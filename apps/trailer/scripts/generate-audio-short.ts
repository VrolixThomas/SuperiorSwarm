// Probes public/audio/short-v1/music.mp3 and rewrites audioManifest.gen.ts.
// If the dedicated short bed exists, AudioBedShort uses it; otherwise it falls
// back to a 20s-offset slice of public/audio/v4/music.mp3.
//
// Drop a 30s dense music track into apps/trailer/public/audio/short-v1/music.mp3
// then `bun scripts/generate-audio-short.ts` to switch off the fallback.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.resolve(projectRoot, "public");
const audioDir = path.resolve(publicDir, "audio/short-v1");
const outFile = path.resolve(projectRoot, "src/hero/short-v1/audioManifest.gen.ts");

async function main() {
	await mkdir(audioDir, { recursive: true });
	const shortMusic = path.join(publicDir, "audio/short-v1/music.mp3");
	const v4Music = path.join(publicDir, "audio/v4/music.mp3");
	const hasShort = existsSync(shortMusic);
	const hasV4 = existsSync(v4Music);
	console.log(`[audio-short] short-v1/music.mp3 → ${hasShort ? "OK" : "MISSING"}`);
	console.log(`[audio-short] v4/music.mp3       → ${hasV4 ? "OK" : "MISSING"}`);

	const lines: string[] = [];
	lines.push("// AUTO-GENERATED. Do not edit. Run: bun scripts/generate-audio-short.ts");
	lines.push("export const AUDIO_AVAILABLE_SHORT = {");
	lines.push(`\tmusic: ${hasShort},`);
	lines.push(`\tmusicFallbackV4: ${!hasShort && hasV4},`);
	lines.push("} as const;");
	await writeFile(outFile, `${lines.join("\n")}\n`, "utf8");
	console.log(`[audio-short] wrote ${outFile}`);
}

main().catch((err) => {
	console.error("[audio-short] failed:", err);
	process.exit(1);
});
