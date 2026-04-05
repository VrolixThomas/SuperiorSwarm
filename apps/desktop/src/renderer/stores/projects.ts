import { create } from "zustand";

export type SettingsCategory = "general" | "integrations" | "ai-review" | "shortcuts" | "terminals" | "about";

interface ProjectStore {
	selectedProjectId: string | null;
	expandedProjectIds: Set<string>;
	isAddModalOpen: boolean;
	isCreateWorktreeModalOpen: boolean;
	createWorktreeProjectId: string | null;
	sharedFilesProjectId: string | null;
	selectProject: (id: string | null) => void;
	toggleProjectExpanded: (id: string) => void;
	openAddModal: () => void;
	closeAddModal: () => void;
	openCreateWorktreeModal: (projectId: string) => void;
	closeCreateWorktreeModal: () => void;
	openSharedFilesPanel: (projectId: string) => void;
	closeSharedFilesPanel: () => void;
	sidebarView: "main" | "settings";
	settingsCategory: SettingsCategory;
	setSettingsCategory: (category: SettingsCategory) => void;
	openSettings: () => void;
	closeSettings: () => void;
	sidebarCollapsed: boolean;
	setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
	selectedProjectId: null,
	expandedProjectIds: new Set<string>(),
	isAddModalOpen: false,
	isCreateWorktreeModalOpen: false,
	createWorktreeProjectId: null,
	sharedFilesProjectId: null,
	sidebarView: "main",
	settingsCategory: "general",
	setSettingsCategory: (category) => set({ settingsCategory: category }),
	sidebarCollapsed: false,
	setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

	selectProject: (id) => set({ selectedProjectId: id }),

	toggleProjectExpanded: (id) =>
		set((state) => {
			const next = new Set(state.expandedProjectIds);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return { expandedProjectIds: next };
		}),

	openAddModal: () => set({ isAddModalOpen: true }),
	closeAddModal: () => set({ isAddModalOpen: false }),

	openCreateWorktreeModal: (projectId) =>
		set({ isCreateWorktreeModalOpen: true, createWorktreeProjectId: projectId }),
	closeCreateWorktreeModal: () =>
		set({ isCreateWorktreeModalOpen: false, createWorktreeProjectId: null }),

	openSharedFilesPanel: (projectId) => set({ sharedFilesProjectId: projectId }),
	closeSharedFilesPanel: () => set({ sharedFilesProjectId: null }),

	openSettings: () => set({ sidebarView: "settings", settingsCategory: "general" }),
	closeSettings: () => set({ sidebarView: "main" }),
}));
