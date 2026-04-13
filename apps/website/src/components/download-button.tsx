"use client";

import { SITE } from "@/lib/constants";
import type { GitHubRelease } from "@/lib/github";

function formatBytes(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(0)} MB`;
}

export function DownloadButton({ release }: { release: GitHubRelease | null }) {
	const href = release?.dmgUrl ?? SITE.download;
	const isDirectDownload = !!release?.dmgUrl;

	return (
		<div className="flex flex-col items-center gap-2">
			<a
				href={href}
				{...(isDirectDownload ? {} : { target: "_blank", rel: "noopener noreferrer" })}
				className="inline-flex items-center gap-2.5 rounded-full bg-accent px-8 py-3 text-[15px] font-semibold text-bg-base transition-shadow hover:shadow-[0_0_24px_rgba(196,149,108,0.3)]"
			>
				<svg
					width={18}
					height={18}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={2.5}
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
					<polyline points="7 10 12 15 17 10" />
					<line x1={12} y1={15} x2={12} y2={3} />
				</svg>
				Download for macOS
			</a>
			{release && (
				<p className="text-[11px] text-text-faint">
					{release.tagName} · Intel &amp; Apple Silicon
					{release.dmgSize ? ` · ${formatBytes(release.dmgSize)}` : ""}
				</p>
			)}
		</div>
	);
}
