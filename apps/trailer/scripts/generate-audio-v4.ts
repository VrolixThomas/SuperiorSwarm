import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BEAT_COPY_V4 } from "../src/hero/build-v4/beat-copy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.resolve(projectRoot, "public");
const audioDir = path.resolve(publicDir, "audio/v4");
const outFile = path.resolve(projectRoot, "src/hero/build-v4/audioManifest.gen.ts");

const API_BASE = "https://api.elevenlabs.io/v1";
const OUTPUT_FORMAT = "mp3_44100_128";
// Eric (premade) — male/american/middle_aged/classy/conversational.
// Closest free-tier match to "Jerry B. - Conversational Marketing Voice"
// (HNLnm2dLXPBSK0FmAPS0), which is a library voice gated behind a paid plan.
const VOICE_ID = process.env["ELEVENLABS_VOICE_ID"] ?? "cjVigY5qzO86Huf0OWal";

const FORCE = process.argv.includes("--force");
const VO_ONLY = process.argv.includes("--vo-only");

const sfxFiles = {
	music: "audio/v4/music.mp3",
	sfxType: "audio/v4/sfx-type.mp3",
	sfxPop: "audio/v4/sfx-pop.mp3",
	sfxWhoosh: "audio/v4/sfx-whoosh.mp3",
	sfxDing: "audio/v4/sfx-ding.mp3",
	sfxChime: "audio/v4/sfx-chime.mp3",
	sfxClick: "audio/v4/sfx-click.mp3",
} as const;

type SfxKey = keyof typeof sfxFiles;

async function loadLocalEnv() {
	const envPath = path.join(projectRoot, ".env.local");
	try {
		const raw = await readFile(envPath, "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const sep = trimmed.indexOf("=");
			if (sep === -1) continue;
			const key = trimmed.slice(0, sep).trim();
			const value = trimmed
				.slice(sep + 1)
				.trim()
				.replace(/^['"]|['"]$/g, "");
			process.env[key] ??= value;
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

async function elevenLabsTTS(text: string): Promise<Buffer> {
	const apiKey = process.env["ELEVENLABS_API_KEY"];
	if (!apiKey) {
		throw new Error("Missing ELEVENLABS_API_KEY in apps/trailer/.env.local");
	}
	const res = await fetch(`${API_BASE}/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "audio/mpeg",
			"xi-api-key": apiKey,
		},
		body: JSON.stringify({
			text,
			model_id: process.env["ELEVENLABS_TTS_MODEL"] ?? "eleven_multilingual_v2",
			voice_settings: {
				stability: 0.45,
				similarity_boost: 0.8,
				style: 0.25,
				use_speaker_boost: true,
			},
			apply_text_normalization: "on",
			seed: 982341,
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`ElevenLabs ${res.status}: ${body}`);
	}
	return Buffer.from(await res.arrayBuffer());
}

async function generateVO(): Promise<Record<string, boolean>> {
	await mkdir(audioDir, { recursive: true });
	const result: Record<string, boolean> = {};
	for (const beat of BEAT_COPY_V4) {
		if (!beat.voiceover) {
			result[beat.key] = false;
			continue;
		}
		const outPath = path.join(audioDir, `vo-${beat.key}.mp3`);
		if (!FORCE && existsSync(outPath)) {
			console.log(`[audio-v4] vo-${beat.key}.mp3 exists, skipping (use --force to regenerate)`);
			result[beat.key] = true;
			continue;
		}
		try {
			const buf = await elevenLabsTTS(beat.voiceover);
			await writeFile(outPath, buf);
			console.log(`[audio-v4] wrote vo-${beat.key}.mp3 (${buf.byteLength} bytes)`);
			result[beat.key] = true;
		} catch (err) {
			console.warn(`[audio-v4] vo-${beat.key} failed:`, (err as Error).message);
			result[beat.key] = false;
		}
	}
	return result;
}

function probeSfx(): Record<SfxKey, boolean> {
	const out = {} as Record<SfxKey, boolean>;
	for (const [key, rel] of Object.entries(sfxFiles) as [SfxKey, string][]) {
		const exists = existsSync(path.join(publicDir, rel));
		out[key] = exists;
		console.log(`[audio-v4] ${rel} → ${exists ? "OK" : "MISSING"}`);
	}
	return out;
}

async function writeManifest(sfx: Record<SfxKey, boolean>, vo: Record<string, boolean>) {
	const lines: string[] = [];
	lines.push("// AUTO-GENERATED. Do not edit. Run: bun scripts/generate-audio-v4.ts");
	lines.push("export const AUDIO_AVAILABLE_V4 = {");
	for (const [key, value] of Object.entries(sfx)) {
		lines.push(`\t${key}: ${value},`);
	}
	lines.push("\tvoiceover: {");
	for (const [key, value] of Object.entries(vo)) {
		lines.push(`\t\t${key}: ${value},`);
	}
	lines.push("\t} as Record<string, boolean>,");
	lines.push("} as const;");
	await writeFile(outFile, `${lines.join("\n")}\n`, "utf8");
	console.log(`[audio-v4] wrote ${outFile}`);
}

async function main() {
	await loadLocalEnv();
	const sfx = VO_ONLY ? probeSfx() : probeSfx();
	const vo = await generateVO();
	await writeManifest(sfx, vo);
	const okCount = Object.values(vo).filter(Boolean).length;
	console.log(`[audio-v4] done. vo ok: ${okCount}/${Object.keys(vo).length}`);
}

main().catch((err) => {
	console.error("[audio-v4] failed:", err);
	process.exit(1);
});
