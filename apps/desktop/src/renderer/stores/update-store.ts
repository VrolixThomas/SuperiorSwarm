import { create } from "zustand";
import {
	type UpdateLifecycleState,
	type UpdateNotification,
	initialUpdateLifecycle,
} from "../../shared/updater";

type ToastState =
	| "hidden"
	| "new-version"
	| "patch"
	| "downloading"
	| "ready"
	| "validating"
	| "installing"
	| "error";

interface UpdateStore {
	startupNotificationHandled: boolean;
	showStartupNotification: (
		notification: Pick<UpdateNotification, "type" | "version" | "summary">
	) => void;
	lifecycle: UpdateLifecycleState;
	installRequested: boolean;
	requestError: string | null;
	applyUpdaterStatus: (status: UpdateLifecycleState) => void;
	beginInstall: () => boolean;
	finishInstallRequest: (status: UpdateLifecycleState) => void;
	failRequest: () => void;
	toastState: ToastState;
	toastVersion: string | null;
	toastSummary: string | null;
	showWhatsNewModal: boolean;
	modalVersion: string | null;
	downloadProgress: number | null;
	dismissedUpdateVersion: string | null;

	showToast: (state: ToastState, version: string, summary: string | null) => void;
	dismissToast: () => void;
	openWhatsNew: (version: string) => void;
	closeWhatsNew: () => void;
	setDownloadProgress: (progress: number) => void;
	setDismissedUpdateVersion: (version: string | null) => void;
	dismissUpdateOptimistic: (version: string) => string | null;
	restoreDismissedUpdateVersion: (version: string | null) => void;
	setUpdateReadyIfNotDismissed: (version: string) => void;
}

export const useUpdateStore = create<UpdateStore>()((set, get) => ({
	startupNotificationHandled: false,
	showStartupNotification: (notification) => {
		if (get().startupNotificationHandled) return;
		set({ startupNotificationHandled: true });
		if (get().toastState !== "hidden" || !["idle", "checking"].includes(get().lifecycle.phase))
			return;
		get().showToast(
			notification.type === "patch" ? "patch" : "new-version",
			notification.version,
			notification.summary
		);
	},
	lifecycle: { ...initialUpdateLifecycle, revision: -1 },
	installRequested: false,
	requestError: null,
	applyUpdaterStatus: (lifecycle) => {
		if (lifecycle.revision <= get().lifecycle.revision) return;
		let toastState: ToastState = "hidden";
		switch (lifecycle.phase) {
			case "available":
			case "downloading":
				toastState = "downloading";
				break;
			case "downloaded":
				toastState = get().dismissedUpdateVersion === lifecycle.updateVersion ? "hidden" : "ready";
				break;
			case "validating":
				toastState = "validating";
				break;
			case "installing":
				toastState = "installing";
				break;
			case "validation-failed":
			case "error":
				toastState = "error";
				break;
			default:
				if (["new-version", "patch"].includes(get().toastState)) toastState = get().toastState;
		}
		set({
			lifecycle,
			toastState,
			toastVersion:
				toastState === "new-version" || toastState === "patch"
					? get().toastVersion
					: lifecycle.updateVersion,
			downloadProgress: lifecycle.downloadProgress,
			installRequested: false,
			requestError: null,
		});
	},
	beginInstall: () => {
		if (get().installRequested || get().lifecycle.phase !== "downloaded") return false;
		set({ installRequested: true, toastState: "validating", requestError: null });
		return true;
	},
	finishInstallRequest: (status) => {
		set({ installRequested: false });
		get().applyUpdaterStatus(status);
	},
	failRequest: () =>
		set({
			installRequested: false,
			toastState: "error",
			requestError: "Could not confirm update status. Try again or quit and reopen SuperiorSwarm.",
		}),
	toastState: "hidden",
	toastVersion: null,
	toastSummary: null,
	showWhatsNewModal: false,
	modalVersion: null,
	downloadProgress: null,
	dismissedUpdateVersion: null,

	showToast: (toastState, version, summary) =>
		set({ toastState, toastVersion: version, toastSummary: summary }),

	dismissToast: () => {
		if (get().toastState === "installing") return;
		set({ toastState: "hidden", toastVersion: null, toastSummary: null });
	},

	openWhatsNew: (version) => set({ showWhatsNewModal: true, modalVersion: version }),

	closeWhatsNew: () => set({ showWhatsNewModal: false, modalVersion: null }),

	setDownloadProgress: (progress) => set({ toastState: "downloading", downloadProgress: progress }),

	setDismissedUpdateVersion: (version) => set({ dismissedUpdateVersion: version }),

	dismissUpdateOptimistic: (version) => {
		const previous = get().dismissedUpdateVersion;
		set({ dismissedUpdateVersion: version, toastState: "hidden" });
		return previous;
	},

	restoreDismissedUpdateVersion: (version) => set({ dismissedUpdateVersion: version }),

	setUpdateReadyIfNotDismissed: (version) => {
		if (get().lifecycle.revision >= 0 && get().lifecycle.phase !== "downloaded") return;
		if (get().dismissedUpdateVersion === version) return;
		set({ toastState: "ready", toastVersion: version, downloadProgress: null });
	},
}));
