import { afterEach, describe, expect, test } from "bun:test";
import { useUpdateStore } from "../src/renderer/stores/update-store";
import { initialUpdateLifecycle } from "../src/shared/updater";

afterEach(() => {
	useUpdateStore.setState(useUpdateStore.getInitialState());
});

describe("update-store", () => {
	test("initial state has toast hidden", () => {
		const state = useUpdateStore.getState();
		expect(state.toastState).toBe("hidden");
		expect(state.showWhatsNewModal).toBe(false);
	});

	test("showToast sets toastState and metadata", () => {
		useUpdateStore.getState().showToast("new-version", "1.2.0", "Great new features");
		const state = useUpdateStore.getState();
		expect(state.toastState).toBe("new-version");
		expect(state.toastVersion).toBe("1.2.0");
		expect(state.toastSummary).toBe("Great new features");
	});

	test("dismissToast hides toast", () => {
		useUpdateStore.getState().showToast("new-version", "1.2.0", null);
		useUpdateStore.getState().dismissToast();
		expect(useUpdateStore.getState().toastState).toBe("hidden");
	});

	test("openWhatsNew opens modal with version only (no release notes in store)", () => {
		useUpdateStore.getState().openWhatsNew("1.2.0");
		const state = useUpdateStore.getState();
		expect(state.showWhatsNewModal).toBe(true);
		expect(state.modalVersion).toBe("1.2.0");
		expect("modalReleaseNotes" in state).toBe(false);
	});

	test("closeWhatsNew closes modal", () => {
		useUpdateStore.getState().openWhatsNew("1.2.0");
		useUpdateStore.getState().closeWhatsNew();
		expect(useUpdateStore.getState().showWhatsNewModal).toBe(false);
	});

	test("openWhatsNew stores the exact version passed (not a different one)", () => {
		useUpdateStore.getState().openWhatsNew("99.0.0");
		expect(useUpdateStore.getState().modalVersion).toBe("99.0.0");
		// Simulates bug scenario: if AboutSettings passed currentVersion (1.0.0) instead of
		// updateVersion (99.0.0), the modal would show the wrong changelog.
		useUpdateStore.getState().closeWhatsNew();
		useUpdateStore.getState().openWhatsNew("1.0.0");
		expect(useUpdateStore.getState().modalVersion).toBe("1.0.0");
	});

	test("setDownloadProgress updates state", () => {
		useUpdateStore.getState().setDownloadProgress(65);
		const state = useUpdateStore.getState();
		expect(state.toastState).toBe("downloading");
		expect(state.downloadProgress).toBe(65);
	});

	test("setUpdateReadyIfNotDismissed transitions to ready state when not dismissed", () => {
		useUpdateStore.getState().setUpdateReadyIfNotDismissed("2.0.0");
		const state = useUpdateStore.getState();
		expect(state.toastState).toBe("ready");
		expect(state.toastVersion).toBe("2.0.0");
		expect(state.downloadProgress).toBeNull();
	});

	test("setDismissedUpdateVersion stores version", () => {
		useUpdateStore.getState().setDismissedUpdateVersion("3.0.0");
		expect(useUpdateStore.getState().dismissedUpdateVersion).toBe("3.0.0");
	});

	test("dismissUpdateOptimistic stores previous dismissed version", () => {
		const store = useUpdateStore.getState();
		store.setDismissedUpdateVersion("1.0.0");
		const snapshot = useUpdateStore.getState();
		const prev = store.dismissUpdateOptimistic("2.0.0");
		expect(prev).toBe("1.0.0");
		expect(snapshot.dismissedUpdateVersion).toBe("1.0.0");
		expect(useUpdateStore.getState().dismissedUpdateVersion).toBe("2.0.0");
	});

	test("restoreDismissedUpdateVersion reverts version", () => {
		const store = useUpdateStore.getState();
		store.setDismissedUpdateVersion("1.0.0");
		const snapshot = useUpdateStore.getState();
		const prev = store.dismissUpdateOptimistic("2.0.0");
		store.restoreDismissedUpdateVersion(prev);
		expect(snapshot.dismissedUpdateVersion).toBe("1.0.0");
		expect(useUpdateStore.getState().dismissedUpdateVersion).toBe("1.0.0");
	});

	test("setUpdateReadyIfNotDismissed gates ready toast", () => {
		const store = useUpdateStore.getState();
		store.setDismissedUpdateVersion("1.0.0");
		const snapshot = useUpdateStore.getState();
		store.setUpdateReadyIfNotDismissed("1.0.0");
		expect(snapshot.toastState).toBe("hidden");
		expect(useUpdateStore.getState().toastState).toBe("hidden");
		store.setUpdateReadyIfNotDismissed("2.0.0");
		expect(snapshot.toastState).toBe("hidden");
		expect(useUpdateStore.getState().toastState).toBe("ready");
	});

	test("dismissed ready toast hides and reappears for newer version", () => {
		const store = useUpdateStore.getState();
		// simulate ready toast for version A
		store.setUpdateReadyIfNotDismissed("1.0.0");
		expect(useUpdateStore.getState().toastState).toBe("ready");
		// dismiss version A
		store.dismissUpdateOptimistic("1.0.0");
		expect(useUpdateStore.getState().toastState).toBe("hidden");
		// new version B should re-show ready toast
		store.setUpdateReadyIfNotDismissed("2.0.0");
		expect(useUpdateStore.getState().toastState).toBe("ready");
	});
});

describe("authoritative updater status", () => {
	test("late validation failure replaces optimistic installing and survives stale polling", () => {
		const store = useUpdateStore.getState();
		store.applyUpdaterStatus({
			...initialUpdateLifecycle,
			revision: 1,
			phase: "downloaded",
			updateDownloaded: true,
			updateVersion: "0.23.2",
		});
		expect(store.beginInstall()).toBe(true);
		expect(store.beginInstall()).toBe(false);
		store.applyUpdaterStatus({
			...initialUpdateLifecycle,
			revision: 3,
			phase: "validation-failed",
			recovery: "reinstall",
			message: "Use the signed download.",
		});
		expect(useUpdateStore.getState().toastState).toBe("error");
		expect(useUpdateStore.getState().installRequested).toBe(false);
		store.applyUpdaterStatus({
			...initialUpdateLifecycle,
			revision: 2,
			phase: "downloaded",
			updateDownloaded: true,
		});
		expect(useUpdateStore.getState().toastState).toBe("error");
	});

	test("a new renderer receives failure instead of restart-ready, even for a dismissed version", () => {
		const store = useUpdateStore.getState();
		store.setDismissedUpdateVersion("0.23.2");
		store.applyUpdaterStatus({
			...initialUpdateLifecycle,
			revision: 5,
			phase: "error",
			recovery: "retry",
			message: "Check your connection.",
			updateVersion: "0.23.2",
		});
		expect(useUpdateStore.getState().toastState).toBe("error");
		expect(useUpdateStore.getState().lifecycle.recovery).toBe("retry");
	});
});

test("late dismissal rollback cannot resurrect ready after native failure", () => {
	const store = useUpdateStore.getState();
	store.applyUpdaterStatus({
		...initialUpdateLifecycle,
		revision: 8,
		phase: "validation-failed",
		recovery: "reinstall",
	});
	store.setUpdateReadyIfNotDismissed("0.23.2");
	expect(useUpdateStore.getState().toastState).toBe("error");
});

test("idle polling preserves the release notification version", () => {
	const store = useUpdateStore.getState();
	store.showToast("patch", "0.23.2", "Fixes");
	store.applyUpdaterStatus({ ...initialUpdateLifecycle, revision: 1 });
	expect(useUpdateStore.getState().toastVersion).toBe("0.23.2");
});

test("startup notification cannot overwrite an update failure", () => {
	const store = useUpdateStore.getState();
	store.applyUpdaterStatus({
		...initialUpdateLifecycle,
		revision: 3,
		phase: "validation-failed",
		recovery: "reinstall",
	});
	store.showStartupNotification({ type: "minor", version: "0.23.0", summary: "Features" });
	expect(useUpdateStore.getState().toastState).toBe("error");
});

test("startup notification is shown once across remounts", () => {
	const store = useUpdateStore.getState();
	store.showStartupNotification({ type: "patch", version: "0.23.0", summary: null });
	expect(useUpdateStore.getState().toastState).toBe("patch");
	store.dismissToast();
	store.showStartupNotification({ type: "patch", version: "0.23.0", summary: null });
	expect(useUpdateStore.getState().toastState).toBe("hidden");
});
