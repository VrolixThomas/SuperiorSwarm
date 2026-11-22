import { eq } from "drizzle-orm";
import { parsePrIdentifier } from "../ai-review/pr-identifier";
import { getDb } from "../db";
import { commentSolveSessions, sessionState } from "../db/schema";
export function queueSolveOrigin(sessionId: string) {
	const row = getDb()
		.select()
		.from(sessionState)
		.where(eq(sessionState.key, `comment-solve-scope:${sessionId}`))
		.get();
	if (!row) return null;
	const scope: unknown = JSON.parse(row.value);
	if (!Array.isArray(scope) || scope.length < 7) return null;
	const [workspaceId, provider, host, accountId, identifier, id, revision] = scope;
	if (
		![workspaceId, provider, host, accountId, identifier, id].every(
			(value) => typeof value === "string"
		) ||
		!Number.isSafeInteger(revision)
	)
		throw new Error("Stored queue solver origin is invalid.");
	const session = getDb()
		.select()
		.from(commentSolveSessions)
		.where(eq(commentSolveSessions.id, sessionId))
		.get();
	if (
		!session ||
		session.workspaceId !== workspaceId ||
		session.prProvider !== provider ||
		session.prIdentifier !== identifier
	)
		throw new Error("Queue solver ownership changed.");
	if (provider !== "github" && provider !== "bitbucket")
		throw new Error("Unsupported queue solver provider.");
	const parsed = parsePrIdentifier(identifier);
	return {
		origin: { id: id as string, revision: revision as number },
		workspaceId: workspaceId as string,
		accountId: accountId as string,
		host: host as string,
		headSha: session.commitSha ?? "",
		prCtx: {
			provider,
			owner: parsed.owner,
			repo: parsed.repo,
			number: parsed.number,
			title: session.prTitle,
			sourceBranch: session.sourceBranch,
			targetBranch: session.targetBranch,
			repoPath: "",
		},
	};
}
export function requireOrdinarySolvePublication(sessionId: string) {
	if (queueSolveOrigin(sessionId))
		throw new Error(
			"This solver started from Queue. Use the guarded publication action with Undo."
		);
}
