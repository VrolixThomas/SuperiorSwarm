import { create } from "zustand";

type ToastState = "hidden" | "new-version" | "patch" | "downloading" | "ready";

interface UpdateStore {
	toastState: ToastState;
	toastVersion: string | null;
	toastSummary: string | null;
	showWhatsNewModal: boolean;
	modalVersion: string | null;
	modalReleaseNotes: string | null;
	downloadProgress: number | null;

	showToast: (state: ToastState, version: string, summary: string | null) => void;
	dismissToast: () => void;
	openWhatsNew: (version: string, releaseNotes: string | null) => void;
	closeWhatsNew: () => void;
	setDownloadProgress: (progress: number) => void;
	setUpdateReady: (version: string) => void;
}

export const useUpdateStore = create<UpdateStore>()((set) => ({
	toastState: "hidden",
	toastVersion: null,
	toastSummary: null,
	showWhatsNewModal: false,
	modalVersion: null,
	modalReleaseNotes: null,
	downloadProgress: null,

	showToast: (toastState, version, summary) =>
		set({ toastState, toastVersion: version, toastSummary: summary }),

	dismissToast: () => set({ toastState: "hidden", toastVersion: null, toastSummary: null }),

	openWhatsNew: (version, releaseNotes) =>
		set({ showWhatsNewModal: true, modalVersion: version, modalReleaseNotes: releaseNotes }),

	closeWhatsNew: () =>
		set({ showWhatsNewModal: false, modalVersion: null, modalReleaseNotes: null }),

	setDownloadProgress: (progress) => set({ toastState: "downloading", downloadProgress: progress }),

	setUpdateReady: (version) =>
		set({ toastState: "ready", toastVersion: version, downloadProgress: null }),
}));
