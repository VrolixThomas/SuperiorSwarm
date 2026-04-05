import { SITE } from "@/lib/constants";

export function CtaLinks() {
	return (
		<>
			<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
				<a
					href={SITE.download}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-bg-base transition-shadow hover:shadow-[0_0_20px_rgba(196,149,108,0.3)]"
				>
					Download for Mac
					<span className="ml-1.5 text-bg-base/60" aria-hidden="true">
						›
					</span>
				</a>
				<a
					href={SITE.github}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center rounded-full border border-border px-6 py-2.5 text-[15px] font-medium text-text-secondary transition-colors hover:border-text-faint hover:text-text-primary"
				>
					Star on GitHub
					<span className="ml-1.5 text-text-faint" aria-hidden="true">
						›
					</span>
				</a>
			</div>
			<p className="mt-3 text-[11px] text-text-faint">Free & open source · macOS</p>
		</>
	);
}
