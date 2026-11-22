import { refreshNow } from "../ai-review/pr-poller";
import {
	describeProjectHookQueueItem,
	initializeProjectHookQueue,
	isProjectHookQueueItemCurrent,
	refreshProjectHookQueue,
} from "./hook-source";
import { isPRQueueItemCurrent } from "./pr-scope";
import { describePRQueueItem } from "./pr-source";
import { registerExternalQueueAdapter } from "./queue-view";
import {
	initializeTicketQueue,
	isTicketQueueItemCurrent,
	refreshTicketQueue,
	stopTicketQueue,
} from "./ticket-runtime";
import { describeTicketQueueItem } from "./ticket-source";
/** Source ownership remains with the existing PR poller and the opt-in project runner. */
export function initializeExternalQueue() {
	initializeTicketQueue();
	const stopHooks = initializeProjectHookQueue();
	const unregisters = [
		registerExternalQueueAdapter(["ticket-start", "ticket-feedback"], {
			describe: describeTicketQueueItem,
			current: isTicketQueueItemCurrent,
		}),
		registerExternalQueueAdapter(["pr-review", "pr-feedback"], {
			describe: describePRQueueItem,
			current: isPRQueueItemCurrent,
		}),
		registerExternalQueueAdapter(["project-hook"], {
			describe: describeProjectHookQueueItem,
			current: isProjectHookQueueItemCurrent,
		}),
	];
	return () => {
		stopTicketQueue();
		stopHooks();
		for (const unregister of unregisters) unregister();
	};
}
export async function refreshExternalQueue() {
	await Promise.allSettled([refreshTicketQueue(), refreshProjectHookQueue(), refreshNow()]);
}
