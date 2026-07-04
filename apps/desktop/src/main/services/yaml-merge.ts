import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Document, isMap, parseDocument } from "yaml";

// Document-based editing (not YAML.parse/YAML.stringify round-trips) so a
// hand-maintained config keeps its comments, anchors, and formatting — we only
// touch the key path we own.

function load(file: string): Document {
	const raw = existsSync(file) ? readFileSync(file, "utf-8") : "";
	const doc = parseDocument(raw);
	if (doc.errors.length > 0) {
		throw new Error(`Invalid YAML in ${file}: ${doc.errors[0]?.message}`);
	}
	// A missing, empty, or comments-only file parses to null contents — that is
	// a valid empty mapping for our purposes. Anything else non-map is not.
	if (doc.contents !== null && !isMap(doc.contents)) {
		throw new Error(`YAML root of ${file} is not a mapping`);
	}
	return doc;
}

function save(file: string, doc: Document): void {
	const dir = dirname(file);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(file, doc.toString(), "utf-8");
}

/** Merge `value` at `keyPath` in a YAML mapping file, creating it if missing. */
export function mergeYamlKey(file: string, keyPath: string[], value: unknown): void {
	const doc = load(file);
	doc.setIn(keyPath, value);
	save(file, doc);
}

/** Remove `keyPath` from a YAML mapping file. No-op if the file is absent. */
export function removeYamlKey(file: string, keyPath: string[]): void {
	if (!existsSync(file)) return;
	const doc = load(file);
	doc.deleteIn(keyPath);
	save(file, doc);
}
