import { describe, expect, test } from "bun:test";
import {
	HermesComposerDraftCoordinator,
	hermesComposerDraftAfterSubmit,
} from "../src/renderer/hermes/hermes-composer-draft-coordinator";
import type { HermesComposerDraftIdentity } from "../src/shared/hermes";

class Deferred<T> {
	readonly promise: Promise<T>;
	resolve!: (value: T) => void;
	reject!: (reason?: unknown) => void;

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

const identity = (
	overrides: Partial<HermesComposerDraftIdentity> = {}
): HermesComposerDraftIdentity => ({
	managerId: "manager-a",
	projectId: "project-a",
	connectionId: "connection-a",
	profileId: "work",
	durableSessionId: "session-a",
	...overrides,
});

const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("Hermes composer draft coordinator", () => {
	test("debounces edits while persisting the latest exact text", async () => {
		const saves: Array<{ identity: HermesComposerDraftIdentity; text: string }> = [];
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: async () => "",
				save: async (scope, text) => {
					saves.push({ identity: scope, text });
				},
			},
			10
		);
		coordinator.subscribe(identity(), () => undefined);
		await settle();

		coordinator.edit(identity(), " first ");
		coordinator.edit(identity(), " first\nsecond ");
		coordinator.edit(identity(), "\tlatest exact text  \n");
		await Bun.sleep(25);

		expect(saves).toEqual([{ identity: identity(), text: "\tlatest exact text  \n" }]);
	});

	test("flushes the latest pending edit on navigation and unmount", async () => {
		const saves: Array<{ identity: HermesComposerDraftIdentity; text: string }> = [];
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: async () => "",
				save: async (scope, text) => {
					saves.push({ identity: scope, text });
				},
			},
			60_000
		);
		const releaseFirst = coordinator.subscribe(identity(), () => undefined);
		await settle();
		coordinator.edit(identity(), "session switch text");

		releaseFirst();
		await settle();
		const second = identity({ durableSessionId: "session-b" });
		const releaseSecond = coordinator.subscribe(second, () => undefined);
		coordinator.edit(second, "tab close text");
		releaseSecond();
		await settle();

		expect(saves).toEqual([
			{ identity: identity(), text: "session switch text" },
			{ identity: second, text: "tab close text" },
		]);
	});

	test("does not replace a local edit with a stale async load", async () => {
		const loaded = new Deferred<string>();
		const seen: string[] = [];
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: () => loaded.promise,
				save: async () => undefined,
			},
			60_000
		);
		coordinator.subscribe(identity(), (text) => seen.push(text));
		coordinator.edit(identity(), "typed before load");

		loaded.resolve("older persisted text");
		await settle();

		expect(seen.at(-1)).toBe("typed before load");
		expect(coordinator.text(identity())).toBe("typed before load");
	});

	test("does not let a stale load suppress a later write back to the loaded text", async () => {
		const loaded = new Deferred<string>();
		const saves: string[] = [];
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: () => loaded.promise,
				save: async (_scope, text) => {
					saves.push(text);
				},
			},
			60_000
		);
		coordinator.subscribe(identity(), () => undefined);
		coordinator.edit(identity(), "newer saved text");
		coordinator.flush(identity());
		await settle();

		loaded.resolve("older loaded text");
		await settle();
		coordinator.edit(identity(), "older loaded text");
		coordinator.flush(identity());
		await settle();

		expect(saves).toEqual(["newer saved text", "older loaded text"]);
	});

	test("serializes async writes so an older completion cannot overwrite the latest text", async () => {
		const firstWrite = new Deferred<void>();
		const calls: string[] = [];
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: async () => "",
				save: (_scope, text) => {
					calls.push(text);
					return calls.length === 1 ? firstWrite.promise : Promise.resolve();
				},
			},
			60_000
		);
		coordinator.subscribe(identity(), () => undefined);
		await settle();
		coordinator.edit(identity(), "older");
		coordinator.flush(identity());
		coordinator.edit(identity(), "latest");
		coordinator.flush(identity());
		await settle();

		expect(calls).toEqual(["older"]);
		firstWrite.resolve();
		await settle();
		expect(calls).toEqual(["older", "latest"]);
	});

	test("clears only a confirmed unchanged submission and retains queued, failed, or newer text", () => {
		expect(
			hermesComposerDraftAfterSubmit({
				currentText: "same",
				currentRevision: 1,
				submittedText: "same",
				submittedRevision: 1,
				disposition: "submitted",
			})
		).toBe("");
		expect(
			hermesComposerDraftAfterSubmit({
				currentText: "new edit",
				currentRevision: 2,
				submittedText: "sent edit",
				submittedRevision: 1,
				disposition: "submitted",
			})
		).toBe("new edit");
		for (const disposition of ["queued", "failed"] as const) {
			expect(
				hermesComposerDraftAfterSubmit({
					currentText: "retain me",
					currentRevision: 1,
					submittedText: "retain me",
					submittedRevision: 1,
					disposition,
				})
			).toBe("retain me");
		}
	});

	test("serializes a confirmed clear behind an in-flight draft write", async () => {
		const firstWrite = new Deferred<void>();
		const calls: string[] = [];
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: async () => "",
				save: (_scope, text) => {
					calls.push(text);
					return calls.length === 1 ? firstWrite.promise : Promise.resolve();
				},
			},
			60_000
		);
		coordinator.subscribe(identity(), () => undefined);
		await settle();
		coordinator.edit(identity(), "submitted text");
		const submission = coordinator.captureSubmission(identity());
		coordinator.flush(identity());

		coordinator.settleSubmission(identity(), submission, "submitted");
		expect(coordinator.text(identity())).toBe("");
		expect(calls).toEqual(["submitted text"]);

		firstWrite.resolve();
		await settle();
		expect(calls).toEqual(["submitted text", ""]);
	});

	test("settles only the matching identity and preserves text typed during submission", async () => {
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: async () => "",
				save: async () => undefined,
			},
			60_000
		);
		const otherIdentity = identity({ durableSessionId: "session-b" });
		coordinator.subscribe(identity(), () => undefined);
		coordinator.subscribe(otherIdentity, () => undefined);
		await settle();
		coordinator.edit(identity(), "submitted text");
		coordinator.edit(otherIdentity, "other session text");
		const submission = coordinator.captureSubmission(identity());

		coordinator.edit(identity(), "new active-turn edit");
		coordinator.settleSubmission(identity(), submission, "submitted");

		expect(coordinator.text(identity())).toBe("new active-turn edit");
		expect(coordinator.text(otherIdentity)).toBe("other session text");
	});

	test("retains a newer edit revision even when it returns to the submitted text", async () => {
		const coordinator = new HermesComposerDraftCoordinator(
			{
				load: async () => "",
				save: async () => undefined,
			},
			60_000
		);
		coordinator.subscribe(identity(), () => undefined);
		await settle();
		coordinator.edit(identity(), "same visible text");
		const submission = coordinator.captureSubmission(identity());

		coordinator.edit(identity(), "temporary newer text");
		coordinator.edit(identity(), "same visible text");
		coordinator.settleSubmission(identity(), submission, "submitted");

		expect(coordinator.text(identity())).toBe("same visible text");
	});
});
