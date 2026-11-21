import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ReviewSnapshotService } from "../src/main/review-explanation/snapshot";
import { snapshotFixture } from "./helpers/review-snapshot-fixture";
const fixture = snapshotFixture();
const request = { workspaceId: "w", targetTipOid: fixture.target, headOid: fixture.head };
afterAll(() => rmSync(fixture.directory, { recursive: true, force: true }));
const tick = () => new Promise((r) => setTimeout(r, 5));
test("default queue handles cached resolve plus both file sides repeatedly", async () => {
	const service = new ReviewSnapshotService({ resolveRoot: async () => fixture.root });
	const snapshot = await service.create(request);
	const file = snapshot.files.find((f) => f.path === "renamed.ts");
	if (!file) throw Error("missing fixture");
	for (let i = 0; i < 5; i++) {
		const results = await Promise.all([
			service.create(request),
			...(["base", "head"] as const).map((side) =>
				service.read({ workspaceId: "w", snapshotId: snapshot.id, fileId: file.id, side })
			),
		]);
		expect(results[1]).toMatchObject({ kind: "text" });
		expect(results[2]).toMatchObject({ kind: "text" });
	}
});
test("queue cap rejects overload, queued cancellation frees capacity, readers stay bounded", async () => {
	const releases: Array<() => void> = [];
	let entered = 0;
	let pause = true;
	const service = new ReviewSnapshotService({
		maxQueued: 1,
		resolveRoot: async () => {
			entered++;
			if (pause) await new Promise<void>((r) => releases.push(r));
			return fixture.root;
		},
	});
	const a = service.create(request);
	const b = service.create(request);
	await tick();
	const controller = new AbortController();
	const c = service.create(request, controller.signal);
	await expect(service.create(request)).rejects.toMatchObject({ code: "BUSY" });
	expect(entered).toBe(2);
	controller.abort();
	await expect(c).rejects.toMatchObject({ code: "CANCELLED" });
	const d = service.create(request);
	expect(entered).toBe(2);
	pause = false;
	for (const r of releases) r();
	await Promise.all([a, b, d]);
	expect(entered).toBe(3);
	expect(await service.create(request)).toMatchObject({ id: expect.any(String) });
});
test("deadline cancels queued and active callers without freeing still-running reader slots", async () => {
	const releases: Array<() => void> = [];
	let pause = true;
	let entered = 0;
	const service = new ReviewSnapshotService({
		requestTimeoutMs: 25,
		maxQueued: 1,
		resolveRoot: async () => {
			entered++;
			if (pause) await new Promise<void>((r) => releases.push(r));
			return fixture.root;
		},
	});
	const results = await Promise.allSettled([
		service.create(request),
		service.create(request),
		service.create(request),
	]);
	expect(results.every((r) => r.status === "rejected" && r.reason.code === "CANCELLED")).toBe(true);
	expect(entered).toBe(2);
	pause = false;
	for (const release of releases) release();
	await tick();
	// Cached work is not involved; this also proves canceled root lookups don't start Git later.
	await expect(service.create({ ...request, headOid: "invalid" })).rejects.toMatchObject({
		code: "INVALID_REVISION",
	});
});
