import { create } from "zustand";
import type { SidebarSegment } from "../../shared/types";

export type SettingsCategory =
	| "general"
	| "integrations"
	| "mcp"
	| "ai-reviewer"
	| "comment-solver"
	| "shortcuts"
	| "terminals"
	| "worktrees"
	| "lsp"
	| "about";

interface ProjectStore {
	selectedProjectId: string | null;
	expandedProjectIds: Set<string>;
	isAddModalOpen: boolean;
	isCreateCrossRepoModalOpen: boolean;
	isCreateWorktreeModalOpen: boolean;
	createWorktreeProjectId: string | null;
	createWorktreeAsOrchestrator: boolean;
	sharedFilesProjectId: string | null;
	selectProject: (id: string | null) => void;
	toggleProjectExpanded: (id: string) => void;
	hydrateExpandedProjects: (ids: string[]) => void;
	openAddModal: () => void;
	closeAddModal: () => void;
	openCreateCrossRepoModal: () => void;
	closeCreateCrossRepoModal: () => void;
	openCreateWorktreeModal: (projectId: string, opts?: { asOrchestrator?: boolean }) => void;
	closeCreateWorktreeModal: () => void;
	isCreateFolderWorkspaceModalOpen: boolean;
	createFolderWorkspaceProjectId: string | null;
	openCreateFolderWorkspaceModal: (projectId: string) => void;
	closeCreateFolderWorkspaceModal: () => void;
	openSharedFilesPanel: (projectId: string) => void;
	closeSharedFilesPanel: () => void;
	sidebarView: "main" | "settings";
	settingsCategory: SettingsCategory;
	setSettingsCategory: (category: SettingsCategory) => void;
	openSettings: () => void;
	closeSettings: () => void;
	settingsReturnTo: SidebarSegment | null;
	openSettingsToIntegrations: (returnTo?: SidebarSegment) => void;
	sidebarCollapsed: boolean;
	setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
	selectedProjectId: null,
	expandedProjectIds: new Set<string>(),
	isAddModalOpen: false,
	isCreateCrossRepoModalOpen: false,
	isCreateWorktreeModalOpen: false,
	createWorktreeProjectId: null,
	createWorktreeAsOrchestrator: false,
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

	hydrateExpandedProjects: (ids) => set({ expandedProjectIds: new Set(ids) }),

	openAddModal: () => set({ isAddModalOpen: true }),
	closeAddModal: () => set({ isAddModalOpen: false }),

	openCreateCrossRepoModal: () => set({ isCreateCrossRepoModalOpen: true }),
	closeCreateCrossRepoModal: () => set({ isCreateCrossRepoModalOpen: false }),

	openCreateWorktreeModal: (projectId, opts) =>
		set({
			isCreateWorktreeModalOpen: true,
			createWorktreeProjectId: projectId,
			createWorktreeAsOrchestrator: opts?.asOrchestrator ?? false,
		}),
	closeCreateWorktreeModal: () =>
		set({
			isCreateWorktreeModalOpen: false,
			createWorktreeProjectId: null,
			createWorktreeAsOrchestrator: false,
		}),

	isCreateFolderWorkspaceModalOpen: false,
	createFolderWorkspaceProjectId: null,
	openCreateFolderWorkspaceModal: (projectId) =>
		set({ isCreateFolderWorkspaceModalOpen: true, createFolderWorkspaceProjectId: projectId }),
	closeCreateFolderWorkspaceModal: () =>
		set({ isCreateFolderWorkspaceModalOpen: false, createFolderWorkspaceProjectId: null }),

	openSharedFilesPanel: (projectId) => set({ sharedFilesProjectId: projectId }),
	closeSharedFilesPanel: () => set({ sharedFilesProjectId: null }),

	settingsReturnTo: null,
	openSettings: () => set({ sidebarView: "settings", settingsCategory: "general" }),
	closeSettings: () => set({ sidebarView: "main", settingsReturnTo: null }),
	openSettingsToIntegrations: (returnTo) =>
		set({
			sidebarView: "settings",
			settingsCategory: "integrations",
			settingsReturnTo: returnTo ?? null,
		}),
}));
