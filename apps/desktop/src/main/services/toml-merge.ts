import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import TOML from "@iarna/toml";

type Obj = Record<string, unknown>;

function load(file: string): Obj {
	if (!existsSync(file)) return {};
	const raw = readFileSync(file, "utf-8");
	if (!raw.trim()) return {};
	return TOML.parse(raw) as Obj;
}

function save(file: string, data: Obj): void {
	const dir = dirname(file);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(file, TOML.stringify(data as TOML.JsonMap), "utf-8");
}

function setPath(root: Obj, path: string[], value: unknown): void {
	let cur: Obj = root;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i] as string;
		if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
		cur = cur[key] as Obj;
	}
	cur[path[path.length - 1] as string] = value;
}

function deletePath(root: Obj, path: string[]): void {
	let cur: Obj = root;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i] as string;
		if (typeof cur[key] !== "object" || cur[key] === null) return;
		cur = cur[key] as Obj;
	}
	delete cur[path[path.length - 1] as string];
}

export function mergeTomlKey(file: string, keyPath: string[], value: unknown): void {
	const data = load(file);
	setPath(data, keyPath, value);
	save(file, data);
}

export function removeTomlKey(file: string, keyPath: string[]): void {
	if (!existsSync(file)) return;
	const data = load(file);
	deletePath(data, keyPath);
	save(file, data);
}
