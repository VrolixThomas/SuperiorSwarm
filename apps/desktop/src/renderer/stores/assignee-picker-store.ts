import { create } from "zustand";
import type { MergedTicketIssue } from "../../shared/tickets";

interface OpenState {
	// Snapshot captured at click time, not a live reference — picker closes on select
	// so staleness after a refetch is not user-visible.
	ticket: MergedTicketIssue;
	position: { x: number; y: number };
}

interface AssigneePickerStore {
	open: OpenState | null;
	openFor: (ticket: MergedTicketIssue, position: { x: number; y: number }) => void;
	close: () => void;
}

export const useAssigneePickerStore = create<AssigneePickerStore>((set) => ({
	open: null,
	openFor: (ticket, position) => set({ open: { ticket, position } }),
	close: () => set({ open: null }),
}));
