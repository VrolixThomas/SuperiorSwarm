import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.resolve(projectRoot, "public");
const outFile = path.resolve(projectRoot, "src/hero/build-v3/audioManifest.gen.ts");

const files = {
	music: "audio/v3/music.mp3",
	sfxKey: "audio/v3/sfx-key.mp3",
	sfxWhoosh: "audio/v3/sfx-whoosh.mp3",
	sfxSlam: "audio/v3/sfx-slam.mp3",
} as const;

async function main() {
	const availability: Record<keyof typeof files, boolean> = {
		music: false,
		sfxKey: false,
		sfxWhoosh: false,
		sfxSlam: false,
	};
	for (const [key, rel] of Object.entries(files) as [keyof typeof files, string][]) {
		const exists = existsSync(path.join(publicDir, rel));
		availability[key] = exists;
		console.log(`[audio-v3] ${rel} → ${exists ? "OK" : "MISSING"}`);
	}
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED. Do not edit. Run: bun scripts/generate-audio-v3.ts");
	lines.push("export const AUDIO_AVAILABLE_V3 = {");
	for (const [key, value] of Object.entries(availability)) {
		lines.push(`\t${key}: ${value},`);
	}
	lines.push("} as const;");
	const body = `${lines.join("\n")}\n`;
	await writeFile(outFile, body, "utf8");
	console.log(`[audio-v3] wrote ${outFile}`);
}

main().catch((err) => {
	console.error("[audio-v3] failed:", err);
	process.exit(1);
});
