import { getLatestChangelogEntry } from "@/lib/changelog";

export function WhatsNewStrip() {
	const entry = getLatestChangelogEntry();
	if (!entry) return null;

	const oneLine = entry.whatsNew.split(/(?<=[.!?])\s+/)[0] ?? "";

	return (
		<div className="mb-6 flex justify-center">
			<a
				href="/changelog"
				className="group inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface/60 px-3 py-1 backdrop-blur transition-colors hover:border-accent/40 hover:bg-bg-surface"
			>
				<span className="rounded-full bg-accent-dim px-1.5 py-px font-mono text-[10px] font-medium text-accent">
					{entry.version}
				</span>
				<span className="max-w-[260px] truncate text-[11px] text-text-secondary md:max-w-[420px] md:text-xs">
					{oneLine}
				</span>
				<span className="text-text-faint transition-transform group-hover:translate-x-0.5">→</span>
			</a>
		</div>
	);
}
