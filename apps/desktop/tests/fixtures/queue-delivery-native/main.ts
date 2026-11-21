import assert from "node:assert/strict";
import { join } from "node:path";
import Database from "better-sqlite3";
import { QueueDeliveryAdmission, replyContentHash } from "../../../src/daemon/queue-delivery";
const db = new Database(join(process.cwd(), "race.db"));
db.pragma("journal_mode=WAL");
db.exec(
	"CREATE TABLE agent_messages(id TEXT PRIMARY KEY,kind TEXT,reporter TEXT,recipient TEXT,in_reply_to TEXT,project_id TEXT,from_workspace_id TEXT,to_workspace_id TEXT,created_at INTEGER,retrieved_at INTEGER,content TEXT);CREATE TABLE activity_queue_deliveries(request_id TEXT PRIMARY KEY,fingerprint TEXT,target TEXT,members TEXT,state TEXT,created_at INTEGER);CREATE TABLE agent_sessions(terminal_id TEXT PRIMARY KEY,workspace_id TEXT,entity_kind TEXT,provider TEXT,provider_session_id TEXT,state TEXT);CREATE TABLE terminal_sessions(id TEXT PRIMARY KEY,workspace_id TEXT);CREATE TABLE activity_queue_sources(source_id TEXT PRIMARY KEY,revision INTEGER,acknowledged_revision INTEGER,error TEXT,candidate TEXT);"
);
const target: import("../../../src/shared/queue-resume").QueueLaunchOwner = {
	type: "terminal",
	workspaceId: "w",
	entity: { kind: "workspace", id: "w" },
	terminalId: "t",
	provider: "claude",
	providerSessionId: "chat",
};
db.prepare("INSERT INTO agent_sessions VALUES ('t','w','workspace','claude','chat','idle')").run();
db.prepare("INSERT INTO terminal_sessions VALUES ('t','w')").run();
db.prepare("INSERT INTO activity_queue_sources VALUES ('source',1,NULL,NULL,?)").run(
	JSON.stringify({ kind: "agent-ready", target })
);
db.prepare("INSERT INTO activity_queue_deliveries VALUES ('request',?,?,?,'reserved',?)").run(
	replyContentHash("hello"),
	JSON.stringify(target),
	JSON.stringify([{ id: "source", revision: 1 }]),
	Date.now()
);
const other = new Database(join(process.cwd(), "race.db"));
other.pragma("busy_timeout=0");
let calls = 0;
const admission = new QueueDeliveryAdmission(db);
assert.equal(
	admission.admit("request", "t", "hello", () => {
		calls++;
		assert.throws(
			() =>
				other
					.prepare("UPDATE activity_queue_sources SET revision=2 WHERE source_id='source'")
					.run(),
			/locked|busy/i,
			"competing WAL writer must not commit between validation and PTY handoff"
		);
		assert.equal(
			(
				other
					.prepare("SELECT state FROM activity_queue_deliveries WHERE request_id='request'")
					.get() as { state: string }
			).state,
			"uncertain",
			"uncertainty must already be durable before side effect"
		);
		return "admitted";
	}),
	"admitted"
);
other.prepare("UPDATE activity_queue_sources SET revision=2 WHERE source_id='source'").run();
assert.equal(
	admission.admit("request", "t", "hello", () => {
		calls++;
		return "admitted";
	}),
	"admitted"
);
assert.equal(calls, 1);
assert.equal(
	(
		db.prepare("SELECT revision FROM activity_queue_sources WHERE source_id='source'").get() as {
			revision: number;
		}
	).revision,
	2
);

db.prepare("UPDATE agent_sessions SET state='hibernating' WHERE terminal_id='t'").run();
let signals = 0;
assert.equal(
	admission.signalSleep("t", target, () => {
		signals++;
		assert.throws(
			() => other.prepare("UPDATE agent_sessions SET state='running' WHERE terminal_id='t'").run(),
			/locked|busy/i
		);
		return true;
	}),
	true
);
other.prepare("UPDATE agent_sessions SET state='running' WHERE terminal_id='t'").run();
assert.equal(
	admission.signalSleep("t", target, () => {
		signals++;
		return true;
	}),
	false
);
assert.equal(signals, 1);
other.close();
db.close();
console.log("native WAL lock, durable uncertainty, replay, and later occurrence: PASS");
