import { AmbientParticles } from "@/components/ambient-particles";
import { CtaFooter } from "@/components/cta-footer";
import { Nav } from "@/components/nav";
import { getChangelog } from "@/lib/changelog";
import { SITE } from "@/lib/constants";
import { getLatestRelease } from "@/lib/github";
import { ReleaseProvider } from "@/lib/release-context";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Changelog",
	description: `Release notes and version history for ${SITE.name}.`,
	alternates: { canonical: "/changelog" },
};

function renderChangeLabel(label: string, pr?: string) {
	if (!pr) return label;
	return (
		<>
			{label}{" "}
			<a
				href={`${SITE.github}/pull/${pr}`}
				target="_blank"
				rel="noopener noreferrer"
				className="font-mono text-text-faint transition-colors hover:text-accent"
			>
				#{pr}
			</a>
		</>
	);
}

function formatDate(iso: string) {
	const d = new Date(`${iso}T00:00:00Z`);
	return d.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

export default async function ChangelogPage() {
	const entries = getChangelog();
	const release = await getLatestRelease();

	return (
		<ReleaseProvider release={release}>
			<AmbientParticles />
			<Nav />
			<main className="relative z-10 pt-32 pb-12 md:pt-40">
				<div className="mx-auto max-w-3xl px-6">
					<header className="mb-16 text-center">
						<p className="font-mono text-[11px] uppercase tracking-[2px] text-text-muted">
							Release notes
						</p>
						<h1 className="mt-3 text-5xl font-bold tracking-[-1px] text-text-primary md:text-6xl">
							Changelog
						</h1>
						<p className="mx-auto mt-4 max-w-md text-[15px] text-text-secondary">
							Every shipped release of {SITE.name}. Newest first.
						</p>
					</header>

					{entries.length === 0 ? (
						<p className="text-center text-text-muted">No releases yet.</p>
					) : (
						<ol className="space-y-16">
							{entries.map((entry, idx) => {
								const isLatest = idx === 0;
								return (
									<li key={entry.version} id={entry.version} className="relative">
										{isLatest && (
											<div className="pointer-events-none absolute -inset-x-6 -inset-y-4 -z-10 rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(196,149,108,0.08)_0%,transparent_60%)]" />
										)}
										<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
											<a
												href={`#${entry.version}`}
												className={`font-mono text-2xl font-semibold ${
													isLatest ? "text-accent" : "text-text-primary"
												}`}
											>
												{entry.version}
											</a>
											<time className="font-mono text-[11px] text-text-faint">
												{formatDate(entry.date)}
											</time>
											{isLatest && (
												<span className="rounded-full bg-accent-dim px-2 py-px text-[10px] font-medium text-accent">
													Latest
												</span>
											)}
										</div>

										{entry.whatsNew && (
											<p className="mt-4 text-[15px] leading-relaxed text-text-secondary">
												{entry.whatsNew}
											</p>
										)}

										{entry.changes.length > 0 && (
											<ul className="mt-5 space-y-2 border-l border-border pl-4">
												{entry.changes.map((c) => (
													<li
														key={`${entry.version}-${c.label}`}
														className="text-[13px] text-text-muted"
													>
														{renderChangeLabel(c.label, c.pr)}
													</li>
												))}
											</ul>
										)}
									</li>
								);
							})}
						</ol>
					)}
				</div>

				<CtaFooter />
			</main>
		</ReleaseProvider>
	);
}
