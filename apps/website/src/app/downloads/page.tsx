import { SITE } from "@/lib/constants";
import { getLatestRelease } from "@/lib/github";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: `Download — ${SITE.name}`,
	robots: { index: false, follow: false },
};

function formatBytes(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(0)} MB`;
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export default async function DownloadsPage() {
	const release = await getLatestRelease();

	return (
		<main className="flex min-h-screen flex-col items-center justify-center px-6">
			<div className="w-full max-w-[560px] text-center">
				{release && (
					<span className="mb-5 inline-block rounded-full border border-accent/30 bg-accent-dim px-3 py-1 font-mono text-xs text-accent">
						{release.tagName} · Released {formatDate(release.publishedAt)}
					</span>
				)}

				<h1 className="mb-3 text-4xl font-bold tracking-tight">Download {SITE.name}</h1>
				<p className="mb-9 text-[15px] leading-relaxed text-text-secondary">
					Free &amp; open source desktop app for Git workflow management.
				</p>

				{release?.dmgUrl ? (
					<>
						<a
							href={release.dmgUrl}
							download
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2.5 rounded-full bg-accent px-8 py-3.5 text-[15px] font-semibold text-bg-base transition-shadow hover:shadow-[0_0_24px_rgba(196,149,108,0.3)]"
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

						<div className="mt-4 flex items-center justify-center gap-3 text-xs text-text-muted">
							<span>Intel &amp; Apple Silicon</span>
							<span>·</span>
							<span>.dmg</span>
							{release.dmgSize && (
								<>
									<span>·</span>
									<span>{formatBytes(release.dmgSize)}</span>
								</>
							)}
						</div>
					</>
				) : (
					<a
						href={SITE.download}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2.5 rounded-full bg-accent px-8 py-3.5 text-[15px] font-semibold text-bg-base transition-shadow hover:shadow-[0_0_24px_rgba(196,149,108,0.3)]"
					>
						Download from GitHub
					</a>
				)}

				<div className="mt-8 border-t border-border pt-6">
					<p className="text-[13px] text-text-muted">
						Or download directly from{" "}
						<a
							href={SITE.download}
							target="_blank"
							rel="noopener noreferrer"
							className="text-accent underline underline-offset-2 transition-colors hover:text-accent/80"
						>
							GitHub Releases
						</a>
					</p>
				</div>
			</div>
		</main>
	);
}
