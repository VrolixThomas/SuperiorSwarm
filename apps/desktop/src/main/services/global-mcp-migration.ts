import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { ensureRepoExclude } from "./git-exclude";
import { removeTomlKey } from "./toml-merge";

const FLAG_KEY = "global_mcp_migration_v2_complete";

interface RepoConfig {
	file: string;
	keyPath: string[];
	parentContainer: string;
	isToml: boolean;
}

function repoConfigsFor(worktreePath: string): RepoConfig[] {
	return [
		{
			file: join(worktreePath, ".mcp.json"),
			keyPath: ["mcpServers", "superiorswarm"],
			parentContainer: "mcpServers",
			isToml: false,
		},
		{
			file: join(worktreePath, ".gemini", "settings.json"),
			keyPath: ["mcpServers", "superiorswarm"],
			parentContainer: "mcpServers",
			isToml: false,
		},
		{
			file: join(worktreePath, ".codex", "config.toml"),
			keyPath: ["mcp_servers", "superiorswarm"],
			parentContainer: "mcp_servers",
			isToml: true,
		},
		{
			file: join(worktreePath, "opencode.json"),
			keyPath: ["mcp", "superiorswarm"],
			parentContainer: "mcp",
			isToml: false,
		},
	];
}

function scrubJson(cfg: RepoConfig): void {
	if (!existsSync(cfg.file)) return;
	let data: Record<string, unknown>;
	try {
		const parsed = JSON.parse(readFileSync(cfg.file, "utf-8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
		data = parsed as Record<string, unknown>;
	} catch {
		return;
	}
	const container = cfg.parentContainer;
	const containerObj = data[container];
	if (containerObj && typeof containerObj === "object" && !Array.isArray(containerObj)) {
		delete (containerObj as Record<string, unknown>).superiorswarm;
		if (Object.keys(containerObj as Record<string, unknown>).length === 0) {
			delete data[container];
		}
	}
	if (Object.keys(data).length === 0) {
		try {
			unlinkSync(cfg.file);
		} catch {}
		return;
	}
	writeFileSync(cfg.file, JSON.stringify(data, null, 2), "utf-8");
}

function scrubToml(cfg: RepoConfig): void {
	if (!existsSync(cfg.file)) return;
	try {
		removeTomlKey(cfg.file, cfg.keyPath);
	} catch {}
}

export function runGlobalMcpMigration(): { scrubbedCount: number } {
	const db = getDb();
	const flag = db
		.select()
		.from(schema.sessionState)
		.where(eq(schema.sessionState.key, FLAG_KEY))
		.get();
	if (flag) return { scrubbedCount: 0 };

	let scrubbedCount = 0;
	const rows = db.select({ path: schema.worktrees.path }).from(schema.worktrees).all();
	for (const r of rows) {
		if (!r.path || !existsSync(r.path)) continue;
		for (const cfg of repoConfigsFor(r.path)) {
			if (existsSync(cfg.file)) {
				if (cfg.isToml) scrubToml(cfg);
				else scrubJson(cfg);
				scrubbedCount++;
			}
		}
	}

	const projectRows = db.select({ repoPath: schema.projects.repoPath }).from(schema.projects).all();
	for (const p of projectRows) {
		if (!p.repoPath || !existsSync(p.repoPath)) continue;
		try {
			ensureRepoExclude(p.repoPath);
		} catch {}
	}

	db.insert(schema.sessionState).values({ key: FLAG_KEY, value: "1" }).run();
	return { scrubbedCount };
}
