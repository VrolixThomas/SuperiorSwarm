import { describe, expect, mock, test } from "bun:test";
import { KeepAwakeService } from "../src/main/services/keep-awake";
import { isSleepDisabled } from "../src/main/services/keep-awake-guard";

function harness(platform = "darwin") {
	let sleepDisabled = false;
	let guard = false;
	const deps = {
		platform,
		createLease: mock(() => "/tmp/test-lease"),
		removeLease: mock((_path: string) => {
			guard = false;
			sleepDisabled = false;
		}),
		authorize: mock(async (_lease: string) => {
			guard = true;
			sleepDisabled = true;
		}),
		readSleepDisabled: mock(async () => sleepDisabled),
		guardExists: () => guard,
		wait: mock(async () => {}),
	};
	return {
		service: new KeepAwakeService(deps),
		deps,
		disableSleep: () => {
			sleepDisabled = true;
		},
	};
}

describe("Mac keep awake", () => {
	test("starts off without a power read, helper, or authorization prompt", () => {
		const { service, deps } = harness();
		expect(service.getState()).toEqual({
			supported: true,
			enabled: false,
			busy: false,
			error: null,
		});
		expect(deps.authorize).not.toHaveBeenCalled();
		expect(deps.readSleepDisabled).not.toHaveBeenCalled();
		expect(deps.createLease).not.toHaveBeenCalled();
	});

	test("authorizes once and verifies power state before reporting on", async () => {
		const { service, deps } = harness();
		expect((await service.setEnabled(true)).enabled).toBe(true);
		await service.setEnabled(true);
		expect(deps.authorize).toHaveBeenCalledTimes(1);
		expect(deps.readSleepDisabled).toHaveBeenCalledTimes(2);
		expect((await service.setEnabled(false)).enabled).toBe(false);
		expect(deps.removeLease).toHaveBeenCalledWith("/tmp/test-lease");
		// Disabling does not require a second administrator prompt.
		expect(deps.authorize).toHaveBeenCalledTimes(1);
	});

	test("canceled authorization leaves the toggle off and removes the lease", async () => {
		const { service, deps } = harness();
		deps.authorize.mockRejectedValueOnce(new Error("Administrator approval was canceled."));
		await expect(service.setEnabled(true)).rejects.toThrow("canceled");
		expect(service.getState()).toMatchObject({ enabled: false, busy: false });
		expect(deps.removeLease).toHaveBeenCalledTimes(1);
	});

	test("rejects unsupported platforms without executing any commands", async () => {
		const { service, deps } = harness("linux");
		expect(service.getState().supported).toBe(false);
		await expect(service.setEnabled(true)).rejects.toThrow("requires macOS");
		expect(deps.authorize).not.toHaveBeenCalled();
		expect(deps.readSleepDisabled).not.toHaveBeenCalled();
	});

	test("preserves a sleep override owned by another application", async () => {
		const { service, deps, disableSleep } = harness();
		disableSleep();
		await expect(service.setEnabled(true)).rejects.toThrow("another app");
		expect(deps.authorize).not.toHaveBeenCalled();
		expect(deps.removeLease).not.toHaveBeenCalled();
	});

	test("does not claim success when macOS rejects the power change", async () => {
		const { service, deps } = harness();
		deps.authorize.mockImplementationOnce(async () => {});
		await expect(service.setEnabled(true)).rejects.toThrow("did not enable");
		expect(service.getState().enabled).toBe(false);
		expect(deps.removeLease).toHaveBeenCalledTimes(1);
	});

	test("rejects overlapping changes and releases a pending authorization on quit", async () => {
		const { service, deps } = harness();
		let complete = () => {};
		deps.authorize.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve;
				})
		);
		const enabling = service.setEnabled(true);
		await Promise.resolve();
		expect(service.getState().busy).toBe(true);
		await expect(service.setEnabled(false)).rejects.toThrow("already in progress");
		service.dispose();
		expect(deps.removeLease).toHaveBeenCalledTimes(1);
		complete();
		await expect(enabling).rejects.toThrow("quitting");
		expect(service.getState().enabled).toBe(false);
	});

	test("quit is idempotent and releases the active lease synchronously", async () => {
		const { service, deps } = harness();
		await service.setEnabled(true);
		service.dispose();
		service.dispose();
		expect(deps.removeLease).toHaveBeenCalledTimes(1);
		await expect(service.setEnabled(true)).rejects.toThrow("quitting");
	});

	test("keeps the toggle on and offers retry if sleep restoration fails", async () => {
		const { service, deps } = harness();
		await service.setEnabled(true);
		deps.removeLease.mockImplementationOnce(() => {});
		await expect(service.setEnabled(false)).rejects.toThrow("Sleep has not been restored");
		expect(service.getState()).toMatchObject({ enabled: true, busy: false });
		expect(deps.wait).toHaveBeenCalledTimes(40);
		deps.guardExists = () => false;
		deps.readSleepDisabled.mockResolvedValue(false);
		expect((await service.setEnabled(false)).enabled).toBe(false);
	});

	test("updates the displayed state if another app removes the override", async () => {
		const { service, deps } = harness();
		await service.setEnabled(true);
		deps.readSleepDisabled.mockResolvedValue(false);
		expect(await service.getCurrentState()).toMatchObject({ enabled: false });
		expect(service.getState().error).toContain("override was removed");
		expect(deps.removeLease).toHaveBeenCalledTimes(1);
	});

	test("reads the system-wide flag without confusing it with idle sleep", () => {
		expect(isSleepDisabled("System-wide power settings:\n SleepDisabled\t\t1\n")).toBe(true);
		expect(isSleepDisabled(" SleepDisabled 0\n sleep 0 (sleep prevented by powerd)\n")).toBe(false);
		expect(isSleepDisabled("System-wide power settings:\n sleep 0\n")).toBe(false);
	});
});
