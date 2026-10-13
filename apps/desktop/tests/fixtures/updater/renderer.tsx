import "./dom";
import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { InstallingOverlay } from "../../../src/renderer/components/InstallingOverlay";
import { UpdateToast } from "../../../src/renderer/components/UpdateToast";
import { AboutSettings } from "../../../src/renderer/components/settings/AboutSettings";
import { useUpdateStore } from "../../../src/renderer/stores/update-store";
import {
	type UpdateLifecycleState,
	type UpdateNotification,
	initialUpdateLifecycle,
} from "../../../src/shared/updater";
import { renderBrowserTest } from "../../helpers/file-browser-renderer";

globalThis.Event = (window as unknown as { Event: typeof Event }).Event;

let status: UpdateLifecycleState & {
	currentVersion: string;
	dismissedUpdateVersion: string | null;
	pendingNotification: UpdateNotification | null;
} = {
	...initialUpdateLifecycle,
	currentVersion: "0.23.0",
	dismissedUpdateVersion: null,
	pendingNotification: null,
};
afterEach(() => useUpdateStore.setState(useUpdateStore.getInitialState()));
const request = (path: string) => {
	if (path === "updates.getStatus") return status;
	if (path === "system.getAgentNotifyPort") return { port: null };
	if (path === "updates.installUpdate")
		return { ...status, phase: "validating", revision: 2, updateDownloaded: false };
	throw new Error(`Unexpected request: ${path}`);
};

test("downloaded UI says validation remains and late errors recover controls via polling", async () => {
	status = {
		...status,
		revision: 1,
		phase: "downloaded",
		updateDownloaded: true,
		updateAvailable: true,
		updateVersion: "0.23.2",
	};
	useUpdateStore.getState().applyUpdaterStatus(status);
	const view = await renderBrowserTest(
		<>
			<AboutSettings />
			<UpdateToast />
			<InstallingOverlay />
		</>,
		[],
		false,
		{ request }
	);
	try {
		expect(view.container.textContent).toContain("validation");
		const restart = [...view.container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Restart")
		);
		expect(restart).toBeDefined();
		await act(async () => {
			restart?.click();
			restart?.click();
		});
		await view.settle();
		expect(view.calls.filter((call) => call.path === "updates.installUpdate")).toHaveLength(1);
		expect(view.container.querySelector('[aria-label="Installing update"]')).toBeNull();
		status = {
			...status,
			revision: 3,
			phase: "validation-failed",
			updateDownloaded: false,
			recovery: "reinstall",
			message:
				"The update was downloaded, but this installation cannot accept its signing requirements. Reinstall from the signed download.",
		};
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1150));
		});
		await view.settle();
		expect(view.container.textContent).toContain("signed download");
		expect(view.container.querySelector('a[href*="releases/latest"]')).not.toBeNull();
		expect(
			[...view.container.querySelectorAll("button")].some((button) =>
				button.textContent?.includes("Restart")
			)
		).toBe(false);
	} finally {
		await view.cleanup();
	}
});

test("a recreated renderer immediately shows current generic failure with an enabled retry", async () => {
	status = {
		...status,
		revision: 4,
		phase: "error",
		updateDownloaded: false,
		recovery: "retry",
		message: "Check your connection and try again.",
	};
	const view = await renderBrowserTest(<AboutSettings />, [], false, { request });
	try {
		expect(view.container.textContent).toContain("Check your connection");
		const check = [...view.container.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Check for updates")
		);
		expect(check?.disabled).toBe(false);
	} finally {
		await view.cleanup();
	}
});

test("startup release notes never replace actionable failure or replay after dismissal", async () => {
	status = {
		...status,
		revision: 9,
		phase: "validation-failed",
		recovery: "reinstall",
		message: "Reinstall from the signed download.",
		pendingNotification: {
			type: "minor",
			version: "0.23.0",
			summary: "Release notes",
			releaseNotes: null,
		},
	};
	const view = await renderBrowserTest(
		<>
			<AboutSettings />
			<UpdateToast />
		</>,
		[],
		false,
		{ request }
	);
	try {
		expect(view.container.textContent).toContain("signed download");
		expect(view.container.textContent).not.toContain("Updated to");
	} finally {
		await view.cleanup();
	}
});

test("unmount during a lost install reply releases the optimistic busy state", async () => {
	status = {
		...status,
		revision: 20,
		phase: "downloaded",
		recovery: "none",
		message: null,
		pendingNotification: null,
		updateDownloaded: true,
	};
	useUpdateStore.getState().applyUpdaterStatus(status);
	const view = await renderBrowserTest(<AboutSettings />, [], false, {
		request: (path) => (path === "updates.installUpdate" ? new Promise(() => {}) : request(path)),
	});
	const restart = [...view.container.querySelectorAll("button")].find((button) =>
		button.textContent?.includes("Restart")
	);
	await act(async () => {
		restart?.click();
	});
	expect(useUpdateStore.getState().installRequested).toBe(true);
	await view.cleanup();
	expect(useUpdateStore.getState().installRequested).toBe(false);
	expect(useUpdateStore.getState().requestError).toContain("Could not confirm");
});

test("a failed check does not label the installed version as the latest verified release", async () => {
	status = {
		...status,
		revision: 30,
		phase: "error",
		recovery: "retry",
		message: "Could not check for updates.",
		updateAvailable: false,
		updateVersion: null,
		updateDownloaded: false,
	};
	const view = await renderBrowserTest(<AboutSettings />, [], false, { request });
	try {
		expect(view.container.textContent).not.toContain("0.23.0 ✓");
	} finally {
		await view.cleanup();
	}
});
