import "./preload-electron-mock";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

test("0067 preserves legacy sessions/messages and enforces polymorphic ownership with foreign keys enabled", () => {
	const root = mkdtempSync(join(tmpdir(), "queue-migration-"));
	const sql = new Database(join(root, "isolated.db"));
	const db = drizzle(sql);
	const migrations = join(import.meta.dir, "../src/main/db/migrations");
	try {
		mkdirSync(join(root, "meta"));
		const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"));
		journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 67);
		writeFileSync(join(root, "meta/_journal.json"), JSON.stringify(journal));
		for (const entry of journal.entries)
			symlinkSync(join(migrations, `${entry.tag}.sql`), join(root, `${entry.tag}.sql`));
		sql.pragma("foreign_keys = ON");
		migrate(db, { migrationsFolder: root });
		sql.exec(
			"INSERT INTO projects(id,name,repo_path,created_at,updated_at) VALUES('p','project','/tmp/isolated-migration',1,1)"
		);
		sql.exec(
			"INSERT INTO workspaces(id,project_id,type,name,sort_order,created_at,updated_at) VALUES('w','p','worktree','workspace',0,1,1)"
		);
		sql.exec(
			"INSERT INTO agent_sessions(terminal_id,workspace_id,provider,provider_session_id,created_at,updated_at) VALUES('t','w','codex','conversation',1,1)"
		);
		sql.exec(
			"INSERT INTO agent_messages(id,project_id,from_workspace_id,to_workspace_id,kind,content,in_reply_to,created_at) VALUES('q','p','w','w','question','Synthetic question',NULL,1234)"
		);
		// Historical ID collision predates the guard; existing FK establishes session ownership as workspace.
		sql.exec(
			"INSERT INTO workspaces(id,project_id,type,name,sort_order,created_at,updated_at) VALUES('same','p','worktree','old workspace',0,1,1)"
		);
		sql.exec(
			"INSERT INTO cross_repo_orchestrators(id,name,work_dir,agent_kind,sort_order,created_at,updated_at) VALUES('same','old coordinator','/tmp','codex',0,1,1)"
		);
		sql.exec(
			"INSERT INTO agent_sessions(terminal_id,workspace_id,provider,created_at,updated_at) VALUES('same-t','same','codex',1,1)"
		);
		const session = sql.prepare("SELECT * FROM agent_sessions").get();
		migrate(db, { migrationsFolder: migrations });
		expect(sql.prepare("SELECT * FROM agent_sessions").get()).toEqual({
			...(session as object),
			entity_kind: "workspace",
		});
		expect(sql.prepare("SELECT * FROM agent_messages").get()).toMatchObject({
			id: "q",
			content: "Synthetic question",
			created_at: 1234,
			reporter: null,
			recipient: null,
			retrieved_at: null,
			to_workspace_id: "w",
		});
		sql.exec("DELETE FROM cross_repo_orchestrators WHERE id='same'");
		expect(
			sql.prepare("SELECT entity_kind FROM agent_sessions WHERE terminal_id='same-t'").get()
		).toEqual({ entity_kind: "workspace" });
		sql.exec("DELETE FROM workspaces WHERE id='same'");
		expect(sql.prepare("SELECT * FROM agent_sessions WHERE terminal_id='same-t'").get()).toBeNull();
		expect(sql.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
		expect(sql.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
		expect(() =>
			sql.exec(
				"INSERT INTO agent_sessions(terminal_id,workspace_id,provider,created_at,updated_at) VALUES('bad','missing','codex',1,1)"
			)
		).toThrow("unknown agent entity");
		expect(() =>
			sql.exec(
				"INSERT INTO cross_repo_orchestrators(id,name,work_dir,agent_kind,sort_order,created_at,updated_at) VALUES('w','collision','/tmp','codex',0,1,1)"
			)
		).toThrow("ambiguous agent entity");
		sql.exec(
			"INSERT INTO cross_repo_orchestrators(id,name,work_dir,agent_kind,sort_order,created_at,updated_at) VALUES('x','coordinator','/tmp','codex',0,1,1)"
		);
		sql.exec(
			"INSERT INTO agent_sessions(terminal_id,workspace_id,entity_kind,provider,created_at,updated_at) VALUES('tx','x','coordinator','codex',1,1)"
		);
		sql.exec("DELETE FROM workspaces WHERE id='w'");
		expect(sql.prepare("SELECT terminal_id FROM agent_sessions").all()).toEqual([
			{ terminal_id: "tx" },
		]);
		sql.exec("DELETE FROM cross_repo_orchestrators WHERE id='x'");
		expect(sql.prepare("SELECT * FROM agent_sessions").all()).toHaveLength(0);
	} finally {
		sql.close();
		rmSync(root, { recursive: true, force: true });
	}
});
