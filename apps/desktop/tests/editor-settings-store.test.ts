import { beforeEach, describe, expect, test } from "bun:test";
import { useEditorSettingsStore } from "../src/renderer/stores/editor-settings";

describe("useEditorSettingsStore", () => {
	beforeEach(() => {
		useEditorSettingsStore.setState({ vimEnabled: false, notificationSoundsEnabled: true });
	});

	test("defaults to vimEnabled: false", () => {
		expect(useEditorSettingsStore.getState().vimEnabled).toBe(false);
	});

	test("setVimEnabled toggles the value", () => {
		useEditorSettingsStore.getState().setVimEnabled(true);
		expect(useEditorSettingsStore.getState().vimEnabled).toBe(true);

		useEditorSettingsStore.getState().setVimEnabled(false);
		expect(useEditorSettingsStore.getState().vimEnabled).toBe(false);
	});

	test("hydrateVimMode sets the value from session state", () => {
		useEditorSettingsStore.getState().hydrateVimMode("true");
		expect(useEditorSettingsStore.getState().vimEnabled).toBe(true);
	});

	test("hydrateVimMode treats undefined as false", () => {
		useEditorSettingsStore.getState().setVimEnabled(true);
		useEditorSettingsStore.getState().hydrateVimMode(undefined);
		expect(useEditorSettingsStore.getState().vimEnabled).toBe(false);
	});

	test("hydrateVimMode treats 'false' string as false", () => {
		useEditorSettingsStore.getState().setVimEnabled(true);
		useEditorSettingsStore.getState().hydrateVimMode("false");
		expect(useEditorSettingsStore.getState().vimEnabled).toBe(false);
	});

	test("defaults to notificationSoundsEnabled: true", () => {
		expect(useEditorSettingsStore.getState().notificationSoundsEnabled).toBe(true);
	});

	test("setNotificationSoundsEnabled toggles the value", () => {
		useEditorSettingsStore.getState().setNotificationSoundsEnabled(false);
		expect(useEditorSettingsStore.getState().notificationSoundsEnabled).toBe(false);

		useEditorSettingsStore.getState().setNotificationSoundsEnabled(true);
		expect(useEditorSettingsStore.getState().notificationSoundsEnabled).toBe(true);
	});

	test("hydrateNotificationSounds sets value from session state", () => {
		useEditorSettingsStore.getState().hydrateNotificationSounds("false");
		expect(useEditorSettingsStore.getState().notificationSoundsEnabled).toBe(false);
	});

	test("hydrateNotificationSounds treats undefined as true (default on)", () => {
		useEditorSettingsStore.getState().setNotificationSoundsEnabled(false);
		useEditorSettingsStore.getState().hydrateNotificationSounds(undefined);
		expect(useEditorSettingsStore.getState().notificationSoundsEnabled).toBe(true);
	});

	test("hydrateNotificationSounds treats 'true' as true", () => {
		useEditorSettingsStore.getState().setNotificationSoundsEnabled(false);
		useEditorSettingsStore.getState().hydrateNotificationSounds("true");
		expect(useEditorSettingsStore.getState().notificationSoundsEnabled).toBe(true);
	});
});
