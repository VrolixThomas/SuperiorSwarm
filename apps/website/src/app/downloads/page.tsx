import { AmbientParticles } from "@/components/ambient-particles";
import { CtaFooter } from "@/components/cta-footer";
import { Nav } from "@/components/nav";
import { SITE } from "@/lib/constants";
import { getLatestRelease } from "@/lib/github";
import { ReleaseProvider } from "@/lib/release-context";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Download",
	description: `Download ${SITE.name} for macOS. Windows and Linux coming soon.`,
	alternates: { canonical: "/downloads" },
};

function bytesToMb(bytes: number | null): string {
	if (!bytes) return "—";
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DownloadsPage() {
	const release = await getLatestRelease();

	const platforms = [
		{
			key: "macos",
			name: "macOS",
			status: "ready" as const,
			detail: release?.dmgUrl
				? `${bytesToMb(release.dmgSize)} · Apple Silicon + Intel`
				: "Universal build · Apple Silicon + Intel",
			requirement: "macOS 12 Monterey or later",
			cta: { label: "Download .dmg", href: release?.dmgUrl ?? SITE.download },
		},
		{
			key: "windows",
			name: "Windows",
			status: "soon" as const,
			detail: "In development",
			requirement: "Windows 10 / 11 (x64)",
			cta: { label: "Join waitlist", href: "/#waitlist" },
		},
		{
			key: "linux",
			name: "Linux",
			status: "soon" as const,
			detail: "In development",
			requirement: ".AppImage · x64 / arm64",
			cta: { label: "Join waitlist", href: "/#waitlist" },
		},
	];

	return (
		<ReleaseProvider release={release}>
			<AmbientParticles />
			<Nav />
			<main className="relative z-10 pt-32 pb-12 md:pt-40">
				<div className="mx-auto max-w-5xl px-6">
					<header className="mb-12 text-center">
						<p className="font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
							Download
						</p>
						<h1 className="mt-3 text-5xl font-bold tracking-[-1px] text-text-primary md:text-6xl">
							Get {SITE.name}
						</h1>
						{release?.tagName && (
							<p className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface px-3 py-1 font-mono text-[11px] text-text-secondary">
								<span className="size-1.5 rounded-full bg-green" />
								Latest: {release.tagName}
								<span className="text-text-faint">·</span>
								<a
									href="/changelog"
									className="text-text-muted transition-colors hover:text-accent"
								>
									release notes
								</a>
							</p>
						)}
					</header>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{platforms.map((p) => {
							const isReady = p.status === "ready";
							return (
								<div
									key={p.key}
									className={`relative overflow-hidden rounded-xl border bg-bg-surface p-6 transition-colors ${
										isReady ? "border-accent/40" : "border-border"
									}`}
								>
									{isReady && (
										<div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(196,149,108,0.18)_0%,transparent_70%)]" />
									)}
									<div className="relative flex items-center justify-between">
										<h2 className="text-lg font-semibold text-text-primary">{p.name}</h2>
										{isReady ? (
											<span className="rounded-full bg-green/15 px-2 py-px text-[10px] font-medium text-green">
												Available
											</span>
										) : (
											<span className="rounded-full bg-bg-elevated px-2 py-px text-[10px] font-medium text-text-faint">
												Coming soon
											</span>
										)}
									</div>
									<p className="relative mt-3 text-[13px] text-text-secondary">{p.detail}</p>
									<p className="relative mt-1 font-mono text-[11px] text-text-faint">
										{p.requirement}
									</p>
									<a
										href={p.cta.href}
										{...(isReady && p.cta.href.startsWith("http")
											? { target: "_blank", rel: "noopener noreferrer" }
											: {})}
										className={`relative mt-6 inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-[13px] font-medium transition-shadow ${
											isReady
												? "bg-accent text-bg-base hover:shadow-[0_0_20px_rgba(196,149,108,0.3)]"
												: "border border-border bg-bg-elevated text-text-secondary hover:border-accent/30"
										}`}
									>
										{p.cta.label}
									</a>
								</div>
							);
						})}
					</div>

					<section className="mt-16 grid gap-8 md:grid-cols-2">
						<div className="rounded-xl border border-border bg-bg-surface/60 p-5">
							<h3 className="text-[11px] font-semibold uppercase tracking-[0.6px] text-text-muted">
								System requirements
							</h3>
							<ul className="mt-3 space-y-1.5 font-mono text-[12px] text-text-secondary">
								<li>· macOS 12 Monterey or later</li>
								<li>· Apple Silicon (M1+) or Intel x64</li>
								<li>· ~250 MB disk · 4 GB RAM</li>
								<li>· Network access for OAuth + integrations</li>
							</ul>
						</div>
						<div className="rounded-xl border border-border bg-bg-surface/60 p-5">
							<h3 className="text-[11px] font-semibold uppercase tracking-[0.6px] text-text-muted">
								Verify your download
							</h3>
							<p className="mt-3 text-[13px] text-text-secondary">
								Builds are signed and notarized by Apple. Full SHA-256 checksums and signatures are
								attached to each{" "}
								<a
									href={SITE.releases}
									target="_blank"
									rel="noopener noreferrer"
									className="text-accent transition-colors hover:underline"
								>
									GitHub release
								</a>
								.
							</p>
						</div>
					</section>
				</div>

				<CtaFooter />
			</main>
		</ReleaseProvider>
	);
}
