import { create } from "zustand";

interface EditorSettingsStore {
	vimEnabled: boolean;
	setVimEnabled: (enabled: boolean) => void;
	hydrateVimMode: (value: string | undefined) => void;
}

export const useEditorSettingsStore = create<EditorSettingsStore>((set) => ({
	vimEnabled: false,
	setVimEnabled: (enabled) => set({ vimEnabled: enabled }),
	hydrateVimMode: (value) => set({ vimEnabled: value === "true" }),
}));
