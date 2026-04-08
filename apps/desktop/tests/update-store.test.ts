import { afterEach, describe, expect, test } from "bun:test";
import { useUpdateStore } from "../src/renderer/stores/update-store";

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

	test("openWhatsNew opens modal and sets notes", () => {
		useUpdateStore.getState().openWhatsNew("1.2.0", "# Changes\n- Feature A");
		const state = useUpdateStore.getState();
		expect(state.showWhatsNewModal).toBe(true);
		expect(state.modalVersion).toBe("1.2.0");
		expect(state.modalReleaseNotes).toBe("# Changes\n- Feature A");
	});

	test("closeWhatsNew closes modal", () => {
		useUpdateStore.getState().openWhatsNew("1.2.0", "notes");
		useUpdateStore.getState().closeWhatsNew();
		expect(useUpdateStore.getState().showWhatsNewModal).toBe(false);
	});

	test("setDownloadProgress updates state", () => {
		useUpdateStore.getState().setDownloadProgress(65);
		const state = useUpdateStore.getState();
		expect(state.toastState).toBe("downloading");
		expect(state.downloadProgress).toBe(65);
	});

	test("setUpdateReady transitions to ready state", () => {
		useUpdateStore.getState().setUpdateReady("2.0.0");
		const state = useUpdateStore.getState();
		expect(state.toastState).toBe("ready");
		expect(state.toastVersion).toBe("2.0.0");
		expect(state.downloadProgress).toBeNull();
	});

	test("setDismissedUpdateVersion stores version", () => {
		useUpdateStore.getState().setDismissedUpdateVersion("3.0.0");
		expect(useUpdateStore.getState().dismissedUpdateVersion).toBe("3.0.0");
	});
});
