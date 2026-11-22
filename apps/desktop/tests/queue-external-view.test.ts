import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import {
	currentExternalQueueItem,
	queueViewBringBack,
	queueViewDone,
	queueViewLater,
	queueViewUndoDone,
	registerExternalQueueAdapter,
} from "../src/main/activity-queue/queue-view";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { activityQueueSnoozes, activityQueueSources } from "../src/main/db/schema-activity-queue";
import { setupTestDb } from "./helpers/db";
let current = true;
beforeAll(() => {
	setupTestDb();
	registerExternalQueueAdapter(["ticket-start"], {
		current: () => current,
		describe: (item) => ({
			...item,
			category: "tickets",
			situation: "ticket-start",
			subject: item.title,
			why: item.summary,
			clearsWhen: "Done",
			sourceLabel: "Linear",
			nextAction: "Start",
			openLabel: "Open ticket",
			detailLabel: "Ticket",
			evidence: [],
			context: { projectName: "Team", projectTint: 1 },
		}),
	});
});
beforeEach(() => {
	current = true;
	getDb().delete(activityQueueSnoozes).run();
	getDb().delete(activityQueueSources).run();
});
function seed(id = "same-number:account-one", fingerprint = "one") {
	const service = new ActivityQueueService();
	return service.observe({
		sourceId: id,
		sourceType: "ticket-start",
		observedAt: Date.now(),
		fingerprint,
		snapshot: {},
		candidate: {
			kind: "ticket-start",
			title: "Ticket",
			summary: "Start work",
			occurredAt: Date.now(),
			reasons: [],
			target: {
				type: "ticket",
				provider: "linear",
				accountId: "a",
				siteId: "linear.app",
				ticketId: id,
				identifier: "SUP-1",
				url: "https://linear.app",
				groupId: "team",
			},
		},
	});
}
test("external Done/Undo/Later are revision-scoped without daemon inventory", async () => {
	const source = seed();
	const input = { id: source.sourceId, revision: source.revision };
	expect((await queueViewDone(input)).status).toBe("acknowledged");
	expect((await queueViewUndoDone(input)).status).toBe("restored");
	expect((await queueViewLater({ ...input, untilChange: true })).status).toBe("snoozed");
	expect((await queueViewBringBack(input)).status).toBe("restored");
});
test("new activity cannot be removed by old Done/Undo/Later", async () => {
	const source = seed();
	const old = { id: source.sourceId, revision: source.revision };
	await queueViewDone(old);
	seed(source.sourceId, "new");
	expect((await queueViewUndoDone(old)).status).toBe("conflict");
	expect((await queueViewDone(old)).status).toBe("conflict");
	expect((await queueViewLater({ ...old, untilChange: true })).status).toBe("conflict");
});
test("source/account errors and forged groups refuse actions", async () => {
	const source = seed();
	const input = { id: source.sourceId, revision: source.revision };
	current = false;
	expect(currentExternalQueueItem(input)).toBeNull();
	expect((await queueViewDone(input)).status).toBe("conflict");
	current = true;
	expect(currentExternalQueueItem({ ...input, members: [input] })).toBeNull();
	new ActivityQueueService().markUnavailable(source.sourceId, "offline");
	expect((await queueViewDone(input)).status).toBe("conflict");
});
test("same ticket number in another account stays untouched", async () => {
	const first = seed();
	const second = seed("same-number:account-two");
	await queueViewDone({ id: first.sourceId, revision: first.revision });
	expect(new ActivityQueueService().read(second.sourceId)?.acknowledgedRevision).toBeNull();
});
