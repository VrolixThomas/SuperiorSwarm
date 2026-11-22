import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CreateWorkspaceRequest, CreateWorkspaceResponse } from "../../shared/control-plane";
import { getDb } from "../db";
import { projects, sessionState, ticketBranchLinks, workspaces } from "../db/schema";
import { prepareTicketQueueAction, recordTicketQueueLink } from "./ticket-runtime";

/** One durable reservation per account/site/ticket occurrence, before any worktree side effect. */
export async function startTicketQueueWorkspace(
	input: CreateWorkspaceRequest & { queueTicket: { id: string; revision: number } },
	create: (input: CreateWorkspaceRequest) => Promise<CreateWorkspaceResponse>
): Promise<CreateWorkspaceResponse> {
	const db = getDb();
	const receipt = input.queueTicket;
	const key = `queue-ticket-start:${receipt.id}:${receipt.revision}`;
	const claim = {
		version: 1,
		sourceId: receipt.id,
		revision: receipt.revision,
		projectId: input.projectId,
		branch: input.branch,
		baseBranch: input.baseBranch,
		createdAt: Date.now(),
	};
	const target = db.transaction(
		(tx) => {
			const prepared = prepareTicketQueueAction({ ...receipt, action: "start" });
			const project = tx.select().from(projects).where(eq(projects.id, input.projectId)).get();
			if (!project || project.kind !== "repo")
				throw new Error("Select an available repository before starting this ticket.");
			const inserted = tx
				.insert(sessionState)
				.values({ key, value: JSON.stringify({ ...claim, state: "creating" }) })
				.onConflictDoNothing()
				.run();
			if (inserted.changes !== 1)
				throw new Error(
					"This ticket Start was already requested. Check the existing workspace before starting again."
				);
			return prepared.target;
		},
		{ behavior: "immediate" }
	);
	let created: CreateWorkspaceResponse | undefined;
	try {
		created = await create({
			projectId: input.projectId,
			branch: input.branch,
			baseBranch: input.baseBranch,
		});
		const workspaceId = created.workspaceId;
		db.transaction(
			(tx) => {
				// Done, replacement, account changes or a failed refresh during creation stop continuation.
				prepareTicketQueueAction({ ...receipt, action: "start" });
				const workspace = tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
				if (!workspace || workspace.projectId !== input.projectId)
					throw new Error("Created workspace ownership could not be verified.");
				tx.insert(ticketBranchLinks)
					.values({
						id: randomUUID(),
						workspaceId,
						provider: target.provider,
						ticketId: target.ticketId,
						createdAt: new Date(),
					})
					.onConflictDoNothing()
					.run();
				recordTicketQueueLink(target, target.ticketId, workspaceId);
				tx.update(sessionState)
					.set({ value: JSON.stringify({ ...claim, state: "created", workspaceId }) })
					.where(eq(sessionState.key, key))
					.run();
			},
			{ behavior: "immediate" }
		);
		return created;
	} catch (error) {
		// createWorkspace can fail after filesystem/DB side effects. Never unlock an uncertain
		// occurrence for automatic retry, even after app restart or a lost response.
		db.update(sessionState)
			.set({
				value: JSON.stringify({ ...claim, state: "uncertain", workspaceId: created?.workspaceId }),
			})
			.where(eq(sessionState.key, key))
			.run();
		throw new Error(
			`${error instanceof Error ? error.message : "Ticket Start could not finish."} Check the existing workspace before trying again; this queue occurrence will not create a second workspace.`
		);
	}
}
