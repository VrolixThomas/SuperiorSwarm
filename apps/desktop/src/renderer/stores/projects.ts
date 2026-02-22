import { create } from "zustand";

interface ProjectStore {
	selectedProjectId: string | null;
	isAddModalOpen: boolean;
	selectProject: (id: string | null) => void;
	openAddModal: () => void;
	closeAddModal: () => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
	selectedProjectId: null,
	isAddModalOpen: false,
	selectProject: (id) => set({ selectedProjectId: id }),
	openAddModal: () => set({ isAddModalOpen: true }),
	closeAddModal: () => set({ isAddModalOpen: false }),
}));
