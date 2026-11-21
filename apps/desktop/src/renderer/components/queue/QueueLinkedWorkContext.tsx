import { useState } from "react";
import type { QueueLinkedWork } from "../../../shared/queue-linked-context";

export function QueueLinkedWorkContext({
	items,
	compact = false,
}: { items?: QueueLinkedWork[]; compact?: boolean }) {
	const [error, setError] = useState<string | null>(null);
	if (!items?.length) return null;
	const content = (
		<>
			<ul className="min-w-0 space-y-2 text-[11px] text-[var(--text-secondary)]">
				{items.map((item) => (
					<li key={`${item.kind}:${item.provider}:${item.id}`} className="min-w-0 break-words">
						<span className="text-[var(--text-tertiary)]">
							{
								{ github: "GitHub", bitbucket: "Bitbucket", linear: "Linear", jira: "Jira" }[
									item.provider
								]
							}{" "}
							· {item.kind === "pr" ? "PR" : "Ticket"}:{" "}
						</span>
						{item.url ? (
							<button
								type="button"
								className="max-w-full break-words text-left text-[var(--accent)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2"
								onClick={() => {
									setError(null);
									void window.electron.shell
										.openExternal(item.url ?? "")
										.catch(() => setError("Could not open the linked item. Try again."));
								}}
								aria-label={`Open ${item.label} in browser`}
							>
								{item.label}
							</button>
						) : (
							<span>{item.label}</span>
						)}
						{item.title && <span> — {item.title}</span>}
						<p className="text-[10px] text-[var(--text-tertiary)]">
							{item.metadata === "cached"
								? "Last synced details"
								: (item.unavailableReason ?? "Details unavailable")}
						</p>
					</li>
				))}
			</ul>
			{error && (
				<p role="alert" className="text-[11px] text-[var(--text-secondary)]">
					{error}
				</p>
			)}
		</>
	);
	return compact ? (
		<details className="relative min-w-0 max-w-[260px] text-[11px]" aria-label="Linked work">
			<summary className="cursor-pointer truncate">Linked work ({items.length})</summary>
			<div className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-32px)] rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-lg">
				{content}
			</div>
		</details>
	) : (
		<section aria-label="Linked work" className="my-3 min-w-0">
			<h3 className="mb-2 text-[11px] text-[var(--text-tertiary)]">Linked work</h3>
			{content}
		</section>
	);
}
