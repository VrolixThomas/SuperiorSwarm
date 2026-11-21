import { expect, test } from "bun:test";
import {
	createReviewPathSettingsSync,
	defaultReviewPathSettings,
} from "../src/renderer/stores/review-path-settings-store";
test("legacy settings are imported once and backend values stay authoritative", async () => {
	let imports = 0;
	const writes: unknown[] = [];
	let backend = { ...defaultReviewPathSettings(), alsoReview: false };
	const sync = createReviewPathSettingsSync(
		{
			get: async () => backend,
			importLegacy: async () => {
				imports++;
				return backend;
			},
			update: async (patch) => {
				writes.push(patch);
				backend = { ...backend, ...patch };
				return backend;
			},
		},
		() => ({ ...defaultReviewPathSettings(), autoMapOnReviewRequest: true })
	);
	expect((await sync.load()).alsoReview).toBe(false);
	await sync.load();
	expect(imports).toBe(1);
	await sync.update({ autoMapOnReviewRequest: true });
	expect(writes).toEqual([{ autoMapOnReviewRequest: true }]);
});
test("failed backend import can retry without overwriting authoritative values", async () => {
	let offline = true;
	const sync = createReviewPathSettingsSync(
		{
			get: async () => defaultReviewPathSettings(),
			importLegacy: async () => {
				if (offline) throw Error("offline");
				return defaultReviewPathSettings();
			},
			update: async () => defaultReviewPathSettings(),
		},
		() => defaultReviewPathSettings()
	);
	await expect(sync.load()).rejects.toThrow("offline");
	offline = false;
	expect(await sync.load()).toEqual(defaultReviewPathSettings());
});
