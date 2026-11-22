import { eq } from "drizzle-orm";
import { reporterAdmissions } from "../activity-queue/reporter-admission";
import { getDb } from "../db";
import { agentSessions } from "../db/schema";

/** Visibility controls only hook handoff, never queue attention or permission outcomes. */
const visibility = new Map<
	string,
	{ visible: boolean; owner: string | null; admission?: { token: string; entityId: string } }
>();
const subscribers = new Set<(terminalId: string, visible: boolean | undefined) => void>();
function owner(terminalId: string): string | null {
	try {
		const row = getDb()
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.terminalId, terminalId))
			.get();
		return row?.providerSessionId
			? JSON.stringify([
					row.entityKind,
					row.workspaceId,
					row.terminalId,
					row.provider,
					row.providerSessionId,
					row.createdAt.getTime(),
				])
			: null;
	} catch {
		return null;
	}
}
export function setPermissionTerminalVisibility(
	terminalId: string,
	visible: boolean | undefined
): void {
	if (visible === undefined) visibility.delete(terminalId);
	else {
		const current = owner(terminalId);
		visibility.set(terminalId, {
			visible,
			owner: current,
			...(current === null && visibility.get(terminalId)?.admission
				? { admission: visibility.get(terminalId)?.admission }
				: {}),
		});
	}
	if (visibility.size > 4096) {
		const oldest = visibility.keys().next().value;
		if (oldest) {
			visibility.delete(oldest);
			for (const handler of subscribers) handler(oldest, undefined);
		}
	}
	for (const handler of subscribers) handler(terminalId, visible);
}
export function permissionTerminalHidden(terminalId: string): boolean {
	const record = visibility.get(terminalId);
	if (record?.admission) {
		const session = getDb()
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.terminalId, terminalId))
			.get();
		const current = session?.providerSessionId
			? {
					type: "terminal" as const,
					entity: { kind: session.entityKind, id: session.workspaceId },
					workspaceId: session.workspaceId,
					terminalId,
					provider: session.provider,
					providerSessionId: session.providerSessionId,
				}
			: null;
		const result = reporterAdmissions.resolve(
			record.admission.token,
			record.admission.entityId,
			terminalId,
			current
		);
		if (result.status === "admitted") {
			record.owner = owner(terminalId);
			record.admission = undefined;
		} else if (result.status === "rejected") {
			record.admission = undefined;
			record.owner = null;
		}
	}
	return record?.visible === false && record.owner !== null && record.owner === owner(terminalId);
}
export function onPermissionTerminalVisibility(
	handler: (terminalId: string, visible: boolean | undefined) => void
): () => void {
	subscribers.add(handler);
	return () => subscribers.delete(handler);
}

/** Called only for a newly allocated dispatch terminal before broadcast. Missing conversation
 * uses the existing first-registration lease, never a later current-session guess. */
export function setPermissionBackgroundDispatchHidden(terminalId: string): void {
	setPermissionTerminalVisibility(terminalId, false);
	const session = getDb()
		.select()
		.from(agentSessions)
		.where(eq(agentSessions.terminalId, terminalId))
		.get();
	if (!session?.managed || session.providerSessionId) return;
	const lease = reporterAdmissions.issue(
		{ kind: session.entityKind, id: session.workspaceId },
		terminalId,
		session.provider
	);
	const record = visibility.get(terminalId);
	if (record) record.admission = { token: lease.token, entityId: session.workspaceId };
}
