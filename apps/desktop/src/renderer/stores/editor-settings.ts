import { create } from "zustand";

interface EditorSettingsStore {
	vimEnabled: boolean;
	setVimEnabled: (enabled: boolean) => void;
	hydrateVimMode: (value: string | undefined) => void;
	notificationSoundsEnabled: boolean;
	setNotificationSoundsEnabled: (enabled: boolean) => void;
	hydrateNotificationSounds: (value: string | undefined) => void;
}

export const useEditorSettingsStore = create<EditorSettingsStore>((set) => ({
	vimEnabled: false,
	setVimEnabled: (enabled) => set({ vimEnabled: enabled }),
	hydrateVimMode: (value) => set({ vimEnabled: value === "true" }),
	notificationSoundsEnabled: true,
	setNotificationSoundsEnabled: (enabled) => set({ notificationSoundsEnabled: enabled }),
	hydrateNotificationSounds: (value) =>
		set({ notificationSoundsEnabled: value !== "false" }),
}));
