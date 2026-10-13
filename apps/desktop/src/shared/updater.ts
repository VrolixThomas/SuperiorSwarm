export type UpdatePhase =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "downloaded"
	| "validating"
	| "installing"
	| "validation-failed"
	| "error";

export interface UpdateLifecycleState {
	revision: number;
	phase: UpdatePhase;
	recovery: "none" | "retry" | "reinstall" | "restart-app";
	message: string | null;
	updateAvailable: boolean;
	updateVersion: string | null;
	downloadProgress: number | null;
	/** Bytes downloaded and awaiting an install attempt, NOT native validation. */
	updateDownloaded: boolean;
}

export const initialUpdateLifecycle: UpdateLifecycleState = {
	revision: 0,
	phase: "idle",
	recovery: "none",
	message: null,
	updateAvailable: false,
	updateVersion: null,
	downloadProgress: null,
	updateDownloaded: false,
};

export function canCheckForUpdates(state: UpdateLifecycleState): boolean {
	return (
		(state.phase === "idle" || state.phase === "error" || state.phase === "validation-failed") &&
		state.recovery !== "restart-app" &&
		state.recovery !== "reinstall"
	);
}

export const SIGNED_DOWNLOAD_URL = "https://github.com/VrolixThomas/SuperiorSwarm/releases/latest";

export interface UpdateNotification {
	type: "major" | "minor" | "patch";
	version: string;
	releaseNotes: string | null;
	summary: string | null;
}
