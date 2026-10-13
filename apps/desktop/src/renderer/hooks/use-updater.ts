import { useEffect, useRef } from "react";
import type { UpdateLifecycleState } from "../../shared/updater";
import { useUpdateStore } from "../stores/update-store";
import { trpc } from "../trpc/client";

/** Poll even after download: native validation can fail later, or while unfocused. */
export function useUpdaterStatus() {
	const query = trpc.updates.getStatus.useQuery(undefined, {
		staleTime: 0,
		refetchInterval: 1_000,
		refetchIntervalInBackground: true,
		refetchOnMount: "always",
	});
	useEffect(() => {
		if (!query.data) return;
		const store = useUpdateStore.getState();
		store.setDismissedUpdateVersion(query.data.dismissedUpdateVersion);
		store.applyUpdaterStatus(query.data);
		if (query.data.pendingNotification)
			store.showStartupNotification(query.data.pendingNotification);
	}, [query.data]);
	return query;
}

export function useUpdateActions() {
	const utils = trpc.useUtils();
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const onSuccess = (status: UpdateLifecycleState) => {
		clearTimeout(timer.current);
		timer.current = undefined;
		useUpdateStore.getState().finishInstallRequest(status);
		void utils.updates.getStatus.invalidate();
	};
	const onError = () => {
		clearTimeout(timer.current);
		timer.current = undefined;
		useUpdateStore.getState().failRequest();
	};
	const install = trpc.updates.installUpdate.useMutation({ onSuccess, onError });
	const check = trpc.updates.checkForUpdates.useMutation({ onSuccess, onError });
	useEffect(
		() => () => {
			if (timer.current === undefined) return;
			clearTimeout(timer.current);
			if (useUpdateStore.getState().installRequested) useUpdateStore.getState().failRequest();
		},
		[]
	);
	return {
		check: () => check.mutate(),
		checking: check.isPending,
		install: () => {
			if (!useUpdateStore.getState().beginInstall()) return;
			window.dispatchEvent(new Event("superiorswarm:save-now"));
			// A lost IPC reply must not leave the renderer busy indefinitely. The
			// main process independently owns the install guard and validation timer.
			timer.current = setTimeout(onError, 15_000);
			install.mutate();
		},
	};
}
