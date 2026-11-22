import type { BrowserLoadError } from "../../shared/browser-load-error";

export function BrowserFailure({
	failure,
	onRetry,
	onNavigate,
}: {
	failure: BrowserLoadError;
	onRetry: () => void;
	onNavigate: (url: string) => void;
}) {
	return (
		<div role="alert" className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
			<div className="w-full max-w-md space-y-4 text-[var(--text-secondary)]">
				<h2 className="text-lg font-medium text-[var(--text)]">This site couldn’t be reached</h2>
				<p className="text-sm leading-6">{failure.message}</p>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						data-browser-retry
						onClick={onRetry}
						className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white"
					>
						Retry
					</button>
					{failure.suggestedUrl && (
						<button
							type="button"
							data-browser-suggested-url={failure.suggestedUrl}
							onClick={() => {
								if (failure.suggestedUrl) onNavigate(failure.suggestedUrl);
							}}
							className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-overlay)]"
						>
							Open {new URL(failure.suggestedUrl).host}
						</button>
					)}
				</div>
				{failure.suggestedUrl && (
					<p className="text-xs leading-5 text-[var(--text-tertiary)]">
						Some websites use an address without “www”. Open that homepage, or edit the address
						above.
					</p>
				)}
				<details className="text-xs text-[var(--text-tertiary)]">
					<summary className="cursor-pointer">Technical details</summary>
					<p className="mt-2">
						Chromium network error {failure.code} · {failure.kind}
					</p>
				</details>
			</div>
		</div>
	);
}
