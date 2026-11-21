import { eq } from "drizzle-orm";
import { reviewPathRunScopeSchema } from "../../shared/review-path-runtime";
import { TerminalCreateError } from "../../shared/terminal-create";
import type { getDb } from "../db";
import { workspaces } from "../db/schema";
import { ReviewPathStorage } from "../review-path/storage";

/** Read-only ownership fence: an owned ID is never authority to launch an agent. */
export function reviewTerminalOwnership(
	db: ReturnType<typeof getDb>,
	id: string,
	workspaceId: string | undefined
): string {
	const mismatch = () => new TerminalCreateError("REVIEW_TERMINAL_OWNERSHIP_MISMATCH");
	const match = /^review-path:(.+):([1-9]\d*)$/.exec(id);
	if (!workspaceId || !match?.[1]) throw mismatch();
	const run = new ReviewPathStorage(db).getRun(match[1]);
	const scope = reviewPathRunScopeSchema.safeParse(
		run && { id: run.id, version: run.version, identity: run.identity }
	);
	if (
		!run ||
		!scope.success ||
		run.terminalId !== id ||
		`review-path:${run.id}:${run.version}` !== id ||
		run.identity.workspaceId !== workspaceId
	)
		throw mismatch();
	const workspace = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
	if (
		!workspace ||
		workspace.type !== "review" ||
		workspace.prProvider !== run.identity.provider ||
		workspace.prIdentifier !== `${run.identity.owner}/${run.identity.repo}#${run.identity.prNumber}`
	)
		throw mismatch();
	// The stable scope must still be identical after the asynchronous inventory read.
	// Ended runs may expose a surviving PTY, so state changes alone do not revoke viewing.
	return JSON.stringify(scope.data);
}
