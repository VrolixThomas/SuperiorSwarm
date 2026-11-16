import type { ActivityQueueListInput } from "../../shared/activity-queue";
import { getDb } from "../db";
import { terminalSessions } from "../db/schema";
import type { DaemonClient } from "../terminal/daemon-client";
import { getDaemonClient } from "../terminal/daemon-instance";
import { getActivityQueueService } from "./service";

type Inventory = Pick<DaemonClient, "isConnected" | "listSessionsStrict">;
const lastConfirmed = new WeakMap<Inventory, ReadonlySet<string>>();

/** A saved workspace report is history, not proof that its agent still exists.
 * Filter the view using confirmed daemon inventory without deleting source data
 * or acknowledgments. A transient disconnect retains the last confirmed view.
 */
export async function listCurrentActivityQueue(
	input: ActivityQueueListInput = {},
	daemon: Inventory | null = getDaemonClient()
) {
	let terminalIds = daemon ? lastConfirmed.get(daemon) : undefined;
	let agentStatusAvailable = false;
	if (daemon?.isConnected) {
		try {
			const sessions = await daemon.listSessionsStrict();
			if (daemon.isConnected) {
				terminalIds = new Set(sessions.map((session) => session.id));
				lastConfirmed.set(daemon, terminalIds);
				agentStatusAvailable = true;
			}
		} catch {
			// Unknown inventory must not be interpreted as confirmed removal.
		}
	}
	const live = terminalIds ?? new Set<string>();
	const liveWorkspaces = new Set(
		getDb()
			.select({ id: terminalSessions.id, workspaceId: terminalSessions.workspaceId })
			.from(terminalSessions)
			.all()
			.filter((terminal) => live.has(terminal.id))
			.map((terminal) => terminal.workspaceId)
	);
	const result = getActivityQueueService().list(input, (item) => {
		if (item.target.type === "workspace") return liveWorkspaces.has(item.target.workspaceId);
		if (item.target.type === "terminal")
			return live.has(item.target.terminalId) && liveWorkspaces.has(item.target.workspaceId);
		return true;
	});
	return { ...result, agentStatusAvailable };
}
