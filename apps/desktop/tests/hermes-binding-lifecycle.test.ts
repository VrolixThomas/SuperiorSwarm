import { describe, expect, test } from "bun:test";
import {
	HermesSelectionGuard,
	settleHermesSelectionAttachmentPromise,
	settleHermesSelectionAttachments,
} from "../src/renderer/hermes/hermes-binding-lifecycle";
import { hermesSessionCompositeIdentityKey } from "../src/shared/hermes";

describe("Hermes renderer selection guard", () => {
	test("changes generations without owning or releasing a Hermes session", () => {
		const guard = new HermesSelectionGuard();
		const sessionA = guard.select("connection-1:session-a");
		const sameA = guard.select("connection-1:session-a");
		const sessionB = guard.select("connection-1:session-b");

		expect(sameA).toEqual(sessionA);
		expect(sessionB.generation).toBe(sessionA.generation + 1);
		expect(guard.isCurrent(sessionA)).toBe(false);
		expect(guard.isCurrent(sessionB)).toBe(true);
	});

	test("rejects late async callbacks after a rapid A-B-A switch", async () => {
		const guard = new HermesSelectionGuard();
		const mutations: string[] = [];
		const firstA = guard.select("connection-1:session-a");
		const callback = Promise.resolve().then(() =>
			guard.runIfCurrent(firstA, () => mutations.push("late-a"))
		);
		guard.select("connection-1:session-b");
		const secondA = guard.select("connection-1:session-a");
		await callback;

		expect(mutations).toEqual([]);
		expect(guard.runIfCurrent(secondA, () => mutations.push("current-a"))).toBe(true);
		expect(mutations).toEqual(["current-a"]);
	});

	test("invalidates pending callbacks on disposal without any release operation", () => {
		const guard = new HermesSelectionGuard();
		const selection = guard.select("connection-1:session-a");
		guard.dispose();
		expect(guard.isCurrent(selection)).toBe(false);
		guard.activate();
		expect(guard.isCurrent(guard.select("connection-1:session-a"))).toBe(true);
	});

	test("releases every late picker or transfer handle after any composite selection change", async () => {
		const initialKey = hermesSessionCompositeIdentityKey("connection-a", "profile-a", "session-a");
		const nextKeys = [
			hermesSessionCompositeIdentityKey("connection-b", "profile-a", "session-a"),
			hermesSessionCompositeIdentityKey("connection-a", "profile-b", "session-a"),
			hermesSessionCompositeIdentityKey("connection-a", "profile-a", "session-b"),
		];

		for (const nextKey of nextKeys) {
			const guard = new HermesSelectionGuard();
			const generation = guard.select(initialKey);
			const accepted: string[] = [];
			const released: string[] = [];
			const completion = Promise.resolve([{ handle: "late-1" }, { handle: "late-2" }]).then(
				(attachments) =>
					settleHermesSelectionAttachments(guard, generation, attachments, {
						accept: (current) => accepted.push(...current.map(({ handle }) => handle)),
						release: ({ handle }) => released.push(handle),
					})
			);
			guard.select(nextKey);
			await completion;

			expect(accepted).toEqual([]);
			expect(released).toEqual(["late-1", "late-2"]);
		}
	});

	test("settles picker promises after unmount and releases every returned handle", async () => {
		const guard = new HermesSelectionGuard();
		const generation = guard.select(
			hermesSessionCompositeIdentityKey("connection-a", "profile-a", "session-a")
		);
		let resolvePicker!: (attachments: Array<{ handle: string }>) => void;
		const picker = new Promise<Array<{ handle: string }>>((resolve) => {
			resolvePicker = resolve;
		});
		const accepted: string[] = [];
		const released: string[] = [];
		const completion = settleHermesSelectionAttachmentPromise(guard, generation, picker, {
			accept: (current) => accepted.push(...current.map(({ handle }) => handle)),
			release: ({ handle }) => released.push(handle),
		});

		guard.dispose();
		resolvePicker([{ handle: "picker-finished-after-unmount" }]);
		await completion;

		expect(accepted).toEqual([]);
		expect(released).toEqual(["picker-finished-after-unmount"]);
	});

	test("releases every completion handle after unmount disposal", async () => {
		const guard = new HermesSelectionGuard();
		const generation = guard.select(
			hermesSessionCompositeIdentityKey("connection-a", "profile-a", "session-a")
		);
		const accepted: string[] = [];
		const released: string[] = [];
		const completion = Promise.resolve([{ handle: "paste-finished-after-unmount" }]).then(
			(attachments) =>
				settleHermesSelectionAttachments(guard, generation, attachments, {
					accept: (current) => accepted.push(...current.map(({ handle }) => handle)),
					release: ({ handle }) => released.push(handle),
				})
		);
		guard.dispose();
		await completion;

		expect(accepted).toEqual([]);
		expect(released).toEqual(["paste-finished-after-unmount"]);
	});
});
