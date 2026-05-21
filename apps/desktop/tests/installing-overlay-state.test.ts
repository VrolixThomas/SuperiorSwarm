import { afterEach, describe, expect, test } from "bun:test";
import { useUpdateStore } from "../src/renderer/stores/update-store";

afterEach(() => {
	useUpdateStore.setState(useUpdateStore.getInitialState());
});

describe("update-store installing state", () => {
	test("setInstalling switches toast to 'installing' and keeps version", () => {
		useUpdateStore.getState().showToast("ready", "1.2.0", null);
		useUpdateStore.getState().setInstalling();
		const state = useUpdateStore.getState();
		expect(state.toastState).toBe("installing");
		expect(state.toastVersion).toBe("1.2.0");
	});

	test("setInstalling is idempotent", () => {
		useUpdateStore.getState().showToast("ready", "1.2.0", null);
		useUpdateStore.getState().setInstalling();
		useUpdateStore.getState().setInstalling();
		expect(useUpdateStore.getState().toastState).toBe("installing");
	});

	test("dismissToast does not exit installing state", () => {
		useUpdateStore.getState().showToast("ready", "1.2.0", null);
		useUpdateStore.getState().setInstalling();
		useUpdateStore.getState().dismissToast();
		expect(useUpdateStore.getState().toastState).toBe("installing");
	});
});
