import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.resolve(projectRoot, "public");
const outFile = path.resolve(projectRoot, "src/hero/build-v4/audioManifest.gen.ts");

const files = {
	music: "audio/v4/music.mp3",
	sfxType: "audio/v4/sfx-type.mp3",
	sfxPop: "audio/v4/sfx-pop.mp3",
	sfxWhoosh: "audio/v4/sfx-whoosh.mp3",
	sfxDing: "audio/v4/sfx-ding.mp3",
	sfxChime: "audio/v4/sfx-chime.mp3",
	sfxClick: "audio/v4/sfx-click.mp3",
} as const;

async function main() {
	const availability: Record<keyof typeof files, boolean> = {
		music: false,
		sfxType: false,
		sfxPop: false,
		sfxWhoosh: false,
		sfxDing: false,
		sfxChime: false,
		sfxClick: false,
	};
	for (const [key, rel] of Object.entries(files) as [keyof typeof files, string][]) {
		const exists = existsSync(path.join(publicDir, rel));
		availability[key] = exists;
		console.log(`[audio-v4] ${rel} → ${exists ? "OK" : "MISSING"}`);
	}
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED. Do not edit. Run: bun scripts/generate-audio-v4.ts");
	lines.push("export const AUDIO_AVAILABLE_V4 = {");
	for (const [key, value] of Object.entries(availability)) {
		lines.push(`\t${key}: ${value},`);
	}
	lines.push("} as const;");
	const body = `${lines.join("\n")}\n`;
	await writeFile(outFile, body, "utf8");
	console.log(`[audio-v4] wrote ${outFile}`);
}

main().catch((err) => {
	console.error("[audio-v4] failed:", err);
	process.exit(1);
});
