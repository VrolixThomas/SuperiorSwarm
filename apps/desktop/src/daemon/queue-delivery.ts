import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ActivityQueueTarget } from "../shared/activity-queue";

type Delivery = "admitted" | "rejected" | "uncertain";
interface Intent {
	request_id: string;
	fingerprint: string;
	target: string;
	members: string;
	state: string;
	created_at: number;
}
export const replyContentHash = (text: string) => createHash("sha256").update(text).digest("hex");
/** The daemon rechecks persisted ownership/state under its SQLite write lock, immediately before PTY admission. */
export class QueueDeliveryAdmission {
	constructor(private db: Database.Database) {}
	admit(requestId: string, terminalId: string, content: string, write: () => Delivery): Delivery {
		const row = this.db
			.prepare("SELECT * FROM activity_queue_deliveries WHERE request_id = ?")
			.get(requestId) as Intent | undefined;
		if (
			!row ||
			row.fingerprint !== replyContentHash(content) ||
			JSON.parse(row.target).terminalId !== terminalId
		)
			return "rejected";
		if (row.state !== "reserved")
			return row.state === "admitted"
				? "admitted"
				: row.state === "rejected"
					? "rejected"
					: "uncertain";
		// Commit uncertainty BEFORE any side effect: a daemon crash/response loss never permits replay.
		const claimed = this.db
			.prepare(
				"UPDATE activity_queue_deliveries SET state = 'uncertain' WHERE request_id = ? AND state = 'reserved'"
			)
			.run(requestId);
		if (!claimed.changes) return "uncertain";
		return this.db
			.transaction(() => {
				let result: Delivery = "rejected";
				if (Date.now() - row.created_at < 30000 && this.current(row, terminalId)) result = write();
				this.db
					.prepare("UPDATE activity_queue_deliveries SET state = ? WHERE request_id = ?")
					.run(result, requestId);
				if (result === "admitted")
					this.db
						.prepare("UPDATE agent_sessions SET state = 'running' WHERE terminal_id = ?")
						.run(terminalId);
				return result;
			})
			.immediate();
	}
	private current(row: Intent, terminalId: string): boolean {
		const target = JSON.parse(row.target) as ActivityQueueTarget;
		if (
			target.type !== "terminal" ||
			target.terminalId !== terminalId ||
			!target.entity ||
			!target.providerSessionId
		)
			return false;
		const session = this.db
			.prepare("SELECT * FROM agent_sessions WHERE terminal_id = ?")
			.get(terminalId) as
			| {
					workspace_id: string;
					entity_kind: string;
					provider: string;
					provider_session_id: string;
					state: string;
			  }
			| undefined;
		const terminal = this.db
			.prepare("SELECT workspace_id FROM terminal_sessions WHERE id = ?")
			.get(terminalId) as { workspace_id: string } | undefined;
		if (
			!session ||
			terminal?.workspace_id !== target.workspaceId ||
			session.workspace_id !== target.workspaceId ||
			session.entity_kind !== target.entity.kind ||
			target.entity.id !== target.workspaceId ||
			session.provider !== target.provider ||
			session.provider_session_id !== target.providerSessionId ||
			!["idle", "error", "needs-input"].includes(String(session.state))
		)
			return false;
		const members = JSON.parse(row.members) as { id: string; revision: number }[];
		let failed = false;
		for (const member of members) {
			const source = this.db
				.prepare("SELECT * FROM activity_queue_sources WHERE source_id = ?")
				.get(member.id) as
				| {
						revision: number;
						acknowledged_revision: number | null;
						error: string | null;
						candidate: string | null;
				  }
				| undefined;
			if (
				!source ||
				source.revision !== member.revision ||
				source.acknowledged_revision === member.revision ||
				source.error ||
				!source.candidate
			)
				return false;
			const candidate = JSON.parse(String(source.candidate));
			if (JSON.stringify(candidate.target) !== JSON.stringify(target)) return false;
			if (candidate.reasons?.some((r: { code: string }) => r.code === "turn-failed")) failed = true;
		}
		if (session.state === "needs-input" && !failed) return false;
		// A newly observed permission/question must also prevent sending to an unrelated input prompt.
		const sources = this.db
			.prepare("SELECT candidate FROM activity_queue_sources WHERE candidate IS NOT NULL")
			.all() as { candidate: string }[];
		for (const source of sources) {
			const candidate = JSON.parse(source.candidate);
			const t = candidate.target;
			if (
				t?.type === "terminal" &&
				t.terminalId === terminalId &&
				t.providerSessionId === target.providerSessionId &&
				candidate.kind === "agent-input" &&
				!candidate.reasons?.some((r: { code: string }) => r.code === "turn-failed")
			)
				return false;
		}
		return true;
	}
}
