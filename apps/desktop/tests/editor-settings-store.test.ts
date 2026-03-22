import { beforeEach, describe, expect, test } from "bun:test";
import { useEditorSettingsStore } from "../src/renderer/stores/editor-settings";

describe("useEditorSettingsStore", () => {
	beforeEach(() => {
		useEditorSettingsStore.setState({ vimEnabled: false });
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
});
