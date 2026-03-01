import { create } from "zustand";

interface ProjectStore {
	selectedProjectId: string | null;
	expandedProjectIds: Set<string>;
	isAddModalOpen: boolean;
	isCreateWorktreeModalOpen: boolean;
	createWorktreeProjectId: string | null;
	selectProject: (id: string | null) => void;
	toggleProjectExpanded: (id: string) => void;
	openAddModal: () => void;
	closeAddModal: () => void;
	openCreateWorktreeModal: (projectId: string) => void;
	closeCreateWorktreeModal: () => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
	selectedProjectId: null,
	expandedProjectIds: new Set<string>(),
	isAddModalOpen: false,
	isCreateWorktreeModalOpen: false,
	createWorktreeProjectId: null,

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
}));
