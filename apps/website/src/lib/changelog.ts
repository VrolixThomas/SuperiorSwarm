import { readFileSync } from "node:fs";
import path from "node:path";

export type ChangelogEntry = {
	version: string;
	date: string;
	whatsNew: string;
	changes: { label: string; pr?: string }[];
};

let cached: ChangelogEntry[] | null = null;

function resolveChangelogPath(): string {
	const candidates: string[] = [
		path.join(process.cwd(), "..", "..", "CHANGELOG.md"),
		path.join(process.cwd(), "..", "CHANGELOG.md"),
		path.join(process.cwd(), "CHANGELOG.md"),
	];
	for (const p of candidates) {
		try {
			readFileSync(p, "utf8");
			return p;
		} catch {}
	}
	return candidates[0] as string;
}

export function getChangelog(): ChangelogEntry[] {
	if (cached) return cached;
	let raw = "";
	try {
		raw = readFileSync(resolveChangelogPath(), "utf8");
	} catch {
		cached = [];
		return cached;
	}

	const lines = raw.split("\n");
	const entries: ChangelogEntry[] = [];
	let current: ChangelogEntry | null = null;
	let section: "whatsNew" | "changes" | null = null;

	for (const line of lines) {
		const versionMatch = line.match(/^##\s+(v[\d.]+)\s+\((\d{4}-\d{2}-\d{2})\)/);
		if (versionMatch?.[1] && versionMatch[2]) {
			if (current) entries.push(current);
			current = {
				version: versionMatch[1],
				date: versionMatch[2],
				whatsNew: "",
				changes: [],
			};
			section = null;
			continue;
		}
		if (!current) continue;

		if (/^###\s+What's New/i.test(line)) {
			section = "whatsNew";
			continue;
		}
		if (/^###\s+Changes/i.test(line)) {
			section = "changes";
			continue;
		}
		if (line.startsWith("## ")) {
			section = null;
			continue;
		}

		if (section === "whatsNew") {
			const trimmed = line.trim();
			if (trimmed) current.whatsNew += (current.whatsNew ? " " : "") + trimmed;
		} else if (section === "changes") {
			const item = line.match(/^-\s+(.+)$/);
			const body = item?.[1];
			if (body) {
				const prMatch = body.match(/\(#(\d+)\)$/);
				const label = prMatch ? body.replace(/\s*\(#\d+\)$/, "") : body;
				current.changes.push({
					label,
					pr: prMatch?.[1],
				});
			}
		}
	}
	if (current) entries.push(current);

	cached = entries;
	return entries;
}

export function getLatestChangelogEntry(): ChangelogEntry | null {
	const entries = getChangelog();
	return entries[0] ?? null;
}
