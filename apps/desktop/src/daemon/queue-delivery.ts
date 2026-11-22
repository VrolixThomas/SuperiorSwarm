import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ActivityQueueTarget } from "../shared/activity-queue";
import {
	type QueueAnswerBinding,
	answerContinuationFits,
	answerContinuationPrompt,
} from "../shared/queue-answer-continuation";
import { type QueueLaunchOwner, queueOwnerKey } from "../shared/queue-resume";

type Delivery = "admitted" | "rejected" | "uncertain";
interface Intent {
	mode?: "live" | "resume";
	answer_binding?: string | null;
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
	admit(
		requestId: string,
		terminalId: string,
		content: string,
		write: (target: QueueLaunchOwner, answer: boolean) => Delivery,
		mode: "live" | "resume" = "live"
	): Delivery {
		const row = this.db
			.prepare("SELECT * FROM activity_queue_deliveries WHERE request_id = ?")
			.get(requestId) as Intent | undefined;
		if (
			!row ||
			(row.mode ?? "live") !== mode ||
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
				if (Date.now() - row.created_at < 30000 && this.current(row, terminalId, content, mode))
					result = write(JSON.parse(row.target), !!row.answer_binding);
				this.db
					.prepare("UPDATE activity_queue_deliveries SET state = ? WHERE request_id = ?")
					.run(result, requestId);
				if (result === "admitted")
					this.db
						.prepare("UPDATE agent_sessions SET state = ? WHERE terminal_id = ?")
						.run(mode === "resume" ? "resuming" : "running", terminalId);
				return result;
			})
			.immediate();
	}
	resumeView(id: string, owner: QueueLaunchOwner, write: () => Delivery): Delivery {
		return this.db
			.transaction(() => {
				const row = this.db
					.prepare(
						"SELECT a.*,t.workspace_id AS terminal_owner FROM agent_sessions a JOIN terminal_sessions t ON t.id=a.terminal_id WHERE a.terminal_id=?"
					)
					.get(id) as Record<string, unknown> | undefined;
				if (
					!row ||
					owner.terminalId !== id ||
					owner.entity?.id !== owner.workspaceId ||
					row["state"] !== "hibernated" ||
					row["workspace_id"] !== owner.workspaceId ||
					row["terminal_owner"] !== owner.workspaceId ||
					row["entity_kind"] !== owner.entity?.kind ||
					row["provider"] !== owner.provider ||
					row["provider_session_id"] !== owner.providerSessionId
				)
					return "rejected";
				const result = write();
				if (result === "admitted")
					this.db.prepare("UPDATE agent_sessions SET state='resuming' WHERE terminal_id=?").run(id);
				return result;
			})
			.immediate();
	}

	signalSleep(id: string, owner: QueueLaunchOwner, signal: () => boolean): boolean {
		return this.db
			.transaction(() => {
				const row = this.db
					.prepare(
						"SELECT a.*,t.workspace_id AS terminal_owner FROM agent_sessions a JOIN terminal_sessions t ON t.id=a.terminal_id WHERE a.terminal_id=?"
					)
					.get(id) as Record<string, unknown> | undefined;
				if (
					!row ||
					owner.terminalId !== id ||
					owner.entity?.id !== owner.workspaceId ||
					row["state"] !== "hibernating" ||
					row["workspace_id"] !== owner.workspaceId ||
					row["terminal_owner"] !== owner.workspaceId ||
					row["entity_kind"] !== owner.entity?.kind ||
					row["provider"] !== owner.provider ||
					row["provider_session_id"] !== owner.providerSessionId
				)
					return false;
				return signal();
			})
			.immediate();
	}

	private current(
		row: Intent,
		terminalId: string,
		content: string,
		mode: "live" | "resume"
	): boolean {
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
			!(mode === "resume" ? ["hibernated"] : ["idle", "error", "needs-input"]).includes(
				String(session.state)
			)
		)
			return false;
		const binding: QueueAnswerBinding | undefined = row.answer_binding
			? JSON.parse(row.answer_binding)
			: undefined;
		let questionSource: string | undefined;
		if (binding) {
			const q = this.db
				.prepare("SELECT * FROM agent_messages WHERE id=?")
				.get(binding.questionId) as Record<string, unknown> | undefined;
			const a = this.db.prepare("SELECT * FROM agent_messages WHERE id=?").get(binding.answerId) as
				| Record<string, unknown>
				| undefined;
			if (
				!q ||
				!a ||
				q["kind"] !== "question" ||
				a["kind"] !== "answer" ||
				a["in_reply_to"] !== q["id"] ||
				a["project_id"] !== q["project_id"] ||
				a["to_workspace_id"] !== q["from_workspace_id"] ||
				q["from_workspace_id"] !== target.workspaceId ||
				Number(a["created_at"]) < Number(q["created_at"]) ||
				a["retrieved_at"] != null ||
				typeof a["content"] !== "string"
			)
				return false;
			const reporter = JSON.parse(String(q["reporter"]));
			const recipient = JSON.parse(String(a["recipient"]));
			if (
				reporter?.type !== "terminal" ||
				recipient?.type !== "terminal" ||
				queueOwnerKey(reporter) !== queueOwnerKey(target) ||
				queueOwnerKey(recipient) !== queueOwnerKey(target) ||
				answerContinuationPrompt(binding, a["content"]) !== content ||
				!answerContinuationFits(content)
			)
				return false;
			const boundAnswers = this.db
				.prepare(
					"SELECT id,recipient FROM agent_messages WHERE kind='answer' AND in_reply_to=? AND project_id=? AND to_workspace_id=? AND created_at>=?"
				)
				.all(q["id"], q["project_id"], q["from_workspace_id"], q["created_at"]) as {
				id: string;
				recipient: string | null;
			}[];
			const validAnswers = boundAnswers.filter((row) => {
				const recipient = row.recipient ? JSON.parse(row.recipient) : null;
				return recipient?.type === "terminal" && queueOwnerKey(recipient) === queueOwnerKey(target);
			});
			if (validAnswers.length !== 1 || validAnswers[0]?.id !== binding.answerId) return false;
			questionSource = `agent-question:${binding.questionId}`;
		}
		// Message insertion is independent of lazy queue projection. Validate authoritative questions too.
		const rawQuestions = this.db
			.prepare("SELECT * FROM agent_messages WHERE kind='question' AND reporter IS NOT NULL")
			.all() as Record<string, unknown>[];
		for (const q of rawQuestions) {
			const reporter = JSON.parse(String(q["reporter"]));
			if (
				reporter?.type !== "terminal" ||
				queueOwnerKey(reporter) !== queueOwnerKey(target) ||
				q["id"] === binding?.questionId
			)
				continue;
			const source = this.db
				.prepare(
					"SELECT revision,acknowledged_revision,fingerprint FROM activity_queue_sources WHERE source_id=?"
				)
				.get(`agent-question:${q["id"]}`) as
				| { revision: number; acknowledged_revision: number | null; fingerprint: string }
				| undefined;
			if (
				source &&
				source.revision === source.acknowledged_revision &&
				source.fingerprint === q["content"]
			)
				continue;
			const answers = this.db
				.prepare(
					"SELECT recipient FROM agent_messages WHERE kind='answer' AND in_reply_to=? AND retrieved_at IS NOT NULL AND project_id=? AND to_workspace_id=? AND created_at>=?"
				)
				.all(q["id"], q["project_id"], q["from_workspace_id"], q["created_at"]) as {
				recipient: string | null;
			}[];
			if (
				!answers.some((a) => {
					const recipient = a.recipient ? JSON.parse(a.recipient) : null;
					return (
						recipient?.type === "terminal" && queueOwnerKey(recipient) === queueOwnerKey(target)
					);
				})
			)
				return false;
		}
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
			.prepare(
				"SELECT source_id,revision,acknowledged_revision,candidate FROM activity_queue_sources WHERE candidate IS NOT NULL"
			)
			.all() as {
			source_id: string;
			revision: number;
			acknowledged_revision: number | null;
			candidate: string;
		}[];
		for (const source of sources) {
			const candidate = JSON.parse(source.candidate);
			const t = candidate.target;
			if (
				binding &&
				t?.terminalId === terminalId &&
				candidate.reasons?.some((r: { code: string }) => r.code.includes("permission"))
			)
				return false;
			if (
				t?.type === "terminal" &&
				t.terminalId === terminalId &&
				t.providerSessionId === target.providerSessionId &&
				((!members.some((member) => member.id === source.source_id) &&
					source.acknowledged_revision !== source.revision) ||
					(candidate.kind === "agent-input" &&
						source.acknowledged_revision !== source.revision &&
						source.source_id !== questionSource &&
						!(binding && source.source_id.startsWith("agent-workspace:")) &&
						!candidate.reasons?.some((r: { code: string }) => r.code === "turn-failed")))
			)
				return false;
		}
		return true;
	}
}
