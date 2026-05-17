import { useUpdateStore } from "../stores/update-store";

export function InstallingOverlay() {
	const toastState = useUpdateStore((s) => s.toastState);
	const version = useUpdateStore((s) => s.toastVersion);

	if (toastState !== "installing") return null;

	return (
		<div
			className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-[var(--bg)]/95 backdrop-blur-sm"
			role="dialog"
			aria-live="polite"
			aria-label="Installing update"
		>
			<div className="size-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
			<div className="text-center">
				<div className="text-[13px] font-semibold text-[var(--text)]">
					Installing update{version ? ` v${version}` : ""}…
				</div>
				<div className="mt-1 text-[11px] text-[var(--text-secondary)]">
					This may take a few seconds. Please don't quit the app.
				</div>
			</div>
		</div>
	);
}
