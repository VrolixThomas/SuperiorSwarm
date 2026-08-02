import { create } from "zustand";

interface TicketRefreshStore {
	refreshError: string | null;
	isRefreshing: boolean;
	setRefreshState: (state: { refreshError: string | null; isRefreshing: boolean }) => void;
}

export const useTicketRefreshStore = create<TicketRefreshStore>()((set) => ({
	refreshError: null,
	isRefreshing: false,
	setRefreshState: (state) => set(state),
}));
