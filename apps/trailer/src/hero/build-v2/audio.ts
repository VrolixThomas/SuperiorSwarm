import type { CopyKey } from "./beat-copy";

export const HERO_V2_AUDIO_DIR = "audio/hero-build-v2";
export const HERO_V2_MUSIC_PATH = `${HERO_V2_AUDIO_DIR}/music.mp3`;

export function heroV2VoicePath(key: CopyKey): string {
	return `${HERO_V2_AUDIO_DIR}/vo-${key}.mp3`;
}

export const HERO_V2_MUSIC_PROMPT = [
	"Instrumental background music for a polished software product launch video.",
	"Calm, confident, warm, and modern.",
	"Use soft analog synth pulses, subtle piano or marimba accents, gentle strings, and restrained cinematic lift.",
	"Keep the arrangement spacious so a female voiceover remains clear.",
	"No vocals, no lyrics, no aggressive drums, no harsh risers.",
	"Apple-style product reveal energy: elegant, optimistic, premium, focused, and human.",
	"Build gently over 68 seconds and end cleanly.",
].join(" ");
