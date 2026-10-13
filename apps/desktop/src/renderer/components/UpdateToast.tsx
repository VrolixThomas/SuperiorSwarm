import { useEffect, useRef } from "react";
import { SIGNED_DOWNLOAD_URL } from "../../shared/updater";
import { useUpdateActions } from "../hooks/use-updater";
import { useUpdateStore } from "../stores/update-store";
import { trpc } from "../trpc/client";

const PATCH_DISMISS_MS = 8_000;

export function UpdateToast() {
	const toastState = useUpdateStore((s) => s.toastState);
	const version = useUpdateStore((s) => s.toastVersion);
	const summary = useUpdateStore((s) => s.toastSummary);
	const progress = useUpdateStore((s) => s.downloadProgress);
	const dismissToast = useUpdateStore((s) => s.dismissToast);
	const openWhatsNew = useUpdateStore((s) => s.openWhatsNew);

	const lifecycle = useUpdateStore((s) => s.lifecycle);
	const requestError = useUpdateStore((s) => s.requestError);
	const actions = useUpdateActions();
	const utils = trpc.useUtils();
	const markSeen = trpc.updates.markVersionSeen.useMutation();
	const dismissUpdate = trpc.updates.dismissUpdate.useMutation({
		onMutate: async ({ version }) => {
			await utils.updates.getStatus.cancel();
			const previous = useUpdateStore.getState().dismissUpdateOptimistic(version);
			return { previous };
		},
		onError: (_err, variables, context) => {
			useUpdateStore.getState().restoreDismissedUpdateVersion(context?.previous ?? null);
			if (variables?.version) {
				useUpdateStore.getState().setUpdateReadyIfNotDismissed(variables.version);
			}
		},
	});

	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Auto-dismiss patch toasts after 8 seconds
	useEffect(() => {
		if (toastState === "patch" && version) {
			timerRef.current = setTimeout(() => {
				dismissToast();
			}, PATCH_DISMISS_MS);
			return () => {
				if (timerRef.current) clearTimeout(timerRef.current);
			};
		}
	}, [toastState, version, dismissToast]);

	if (toastState === "hidden") return null;

	const handleDismiss = () => {
		if ((toastState === "new-version" || toastState === "patch") && version) {
			markSeen.mutate({ version });
		}
		dismissToast();
	};

	const handleSeeWhatsNew = () => {
		if (version) {
			openWhatsNew(version);
			dismissToast();
		}
	};

	const handleLater = () => {
		if (version) {
			dismissUpdate.mutate({ version });
		}
	};

	if (toastState === "validating" || toastState === "error") {
		return (
			<div className="fixed bottom-4 right-4 z-50 w-[340px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-lg)]">
				<p
					role={toastState === "error" ? "alert" : "status"}
					className="text-[12px] text-[var(--text)]"
				>
					{toastState === "validating"
						? "Validating update before restart. You can keep working."
						: (requestError ?? lifecycle.message)}
				</p>
				{toastState === "error" && (
					<div className="mt-3 flex gap-3 text-[11px] text-[var(--accent)]">
						{lifecycle.recovery === "retry" && (
							<button type="button" disabled={actions.checking} onClick={actions.check}>
								Check for updates
							</button>
						)}
						{requestError && lifecycle.phase === "downloaded" && (
							<button type="button" onClick={actions.install}>
								Retry restart
							</button>
						)}
						{(lifecycle.recovery === "reinstall" || lifecycle.recovery === "restart-app") && (
							<a href={SIGNED_DOWNLOAD_URL} target="_blank" rel="noreferrer">
								Get signed download
							</a>
						)}
						<button type="button" onClick={dismissToast}>
							Dismiss
						</button>
					</div>
				)}
			</div>
		);
	}

	// State 1: Major/Minor update
	if (toastState === "new-version") {
		return (
			<div className="fixed bottom-4 right-4 z-50 w-[300px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-[14px_18px] shadow-[var(--shadow-lg)]">
				<div className="mb-2 flex items-center gap-2">
					<div className="size-[7px] shrink-0 rounded-full bg-[var(--accent)]" />
					<span className="text-[13px] font-semibold text-[var(--text)]">
						Updated to v{version}
					</span>
				</div>
				{summary && (
					<p className="mb-2.5 text-[11px] leading-[1.5] text-[var(--text-secondary)]">{summary}</p>
				)}
				<div className="flex items-center">
					<button
						type="button"
						onClick={handleSeeWhatsNew}
						className="text-[11px] font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
					>
						See what's new →
					</button>
					<button
						type="button"
						onClick={handleDismiss}
						className="ml-auto text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
					>
						Dismiss
					</button>
				</div>
			</div>
		);
	}

	// State 2: Patch update
	if (toastState === "patch") {
		return (
			<div className="fixed bottom-4 right-4 z-50 w-[260px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] px-[14px] py-[10px] shadow-[var(--shadow-md)]">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<div className="size-[5px] shrink-0 rounded-full bg-[var(--text-tertiary)]" />
						<span className="text-[11px] text-[var(--text-secondary)]">Updated to v{version}</span>
					</div>
					<button
						type="button"
						onClick={handleDismiss}
						className="text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
					>
						✕
					</button>
				</div>
			</div>
		);
	}

	// State 3: Downloading
	if (toastState === "downloading") {
		return (
			<div className="fixed bottom-4 right-4 z-50 w-[300px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-[14px_18px] shadow-[var(--shadow-lg)]">
				<div className="mb-2 flex items-center gap-2">
					<span className="text-[13px] font-semibold text-[var(--text)]">
						Downloading v{version}...
					</span>
				</div>
				<div className="mb-2 h-1 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
					<div
						className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
						style={{ width: `${progress ?? 0}%` }}
					/>
				</div>
				<div className="text-[10px] text-[var(--text-tertiary)]">{progress ?? 0}%</div>
			</div>
		);
	}

	// State 4: Update ready
	if (toastState === "ready") {
		return (
			<div className="fixed bottom-4 right-4 z-50 w-[300px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-[14px_18px] shadow-[var(--shadow-lg)]">
				<div className="mb-2 flex items-center gap-2">
					<div className="size-[7px] shrink-0 rounded-full bg-[#30d158]" />
					<span className="text-[13px] font-semibold text-[var(--text)]">Update downloaded</span>
				</div>
				<p className="mb-2.5 text-[11px] leading-[1.5] text-[var(--text-secondary)]">
					v{version} has been downloaded. Compatibility validation is still pending. Restart to
					validate and install.
				</p>
				<div className="flex items-center">
					<button
						type="button"
						onClick={actions.install}
						className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-[5px] text-[11px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
					>
						Restart now
					</button>
					<button
						type="button"
						onClick={handleLater}
						className="ml-auto text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
					>
						Later
					</button>
				</div>
			</div>
		);
	}

	return null;
}
