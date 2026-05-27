"use client";

import { DownloadButton } from "@/components/download-button";
import { WaitlistForm } from "@/components/waitlist-form";
import { SITE } from "@/lib/constants";
import { useRelease } from "@/lib/release-context";
import { shouldShowDownload, useDetectedPlatform } from "@/lib/use-detected-platform";
import { useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { Section } from "./section";
import { SocialIcons } from "./social-icons";

function generateFooterParticles() {
	return Array.from({ length: 10 }, (_, i) => ({
		id: i,
		left: `${15 + Math.random() * 70}%`,
		size: 2 + Math.random() * 2,
		opacity: 0.5 + Math.random() * 0.3,
		duration: 4 + Math.random() * 4,
		delay: Math.random() * -6,
		color: Math.random() > 0.5 ? "var(--color-accent)" : "var(--color-brand)",
	}));
}

const FOOTER_NAV: {
	heading: string;
	links: { label: string; href: string; external?: boolean }[];
}[] = [
	{
		heading: "Product",
		links: [
			{ label: "Download", href: "/downloads" },
			{ label: "Changelog", href: "/changelog" },
			{ label: "Releases", href: SITE.releases, external: true },
			{ label: "GitHub", href: SITE.github, external: true },
		],
	},
	{
		heading: "Resources",
		links: [
			{ label: "Features", href: "/#features" },
			{ label: "Issues", href: `${SITE.github}/issues`, external: true },
		],
	},
	{
		heading: "Legal",
		links: [
			{ label: "Privacy", href: "/privacy" },
			{ label: "Terms", href: "/terms" },
			{ label: "License", href: `${SITE.github}/blob/main/LICENSE.md`, external: true },
		],
	},
];

export function CtaFooter() {
	const reduced = useReducedMotion();
	const footerParticles = useMemo(() => generateFooterParticles(), []);
	const platform = useDetectedPlatform();
	const release = useRelease();
	const showDownload = shouldShowDownload(platform);
	const year = new Date().getFullYear();

	return (
		<Section id="waitlist" label="Join Waitlist" className="text-center">
			<div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse,var(--color-brand-glow)_0%,transparent_70%)]" />

			<div className="pointer-events-none absolute left-0 right-0 top-8 h-24" aria-hidden="true">
				{footerParticles.map((p) => (
					<div
						key={p.id}
						className="absolute rounded-full"
						style={{
							left: p.left,
							bottom: 0,
							width: p.size,
							height: p.size,
							backgroundColor: p.color,
							opacity: reduced ? p.opacity * 0.5 : 0,
							animation: reduced
								? "none"
								: `particle-rise ${p.duration}s ease-out ${p.delay}s infinite`,
						}}
					/>
				))}
			</div>

			<h2 className="relative text-4xl font-semibold tracking-tight text-text-primary md:text-5xl">
				Ready to manage your swarm?
			</h2>

			<div className="relative mt-8 flex flex-col items-center">
				{showDownload ? (
					<DownloadButton release={release} />
				) : (
					<WaitlistForm platform={platform === "windows" ? "windows" : "linux"} />
				)}
				<a
					href={SITE.discord}
					target="_blank"
					rel="noopener noreferrer"
					className="mt-5 inline-flex items-center gap-2 text-[13px] text-text-muted transition-colors hover:text-text-primary"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
					</svg>
					Join the community on Discord
				</a>
			</div>

			<div className="relative mt-20">
				<div
					className="mx-auto h-px max-w-2xl"
					style={{
						background: "linear-gradient(90deg, transparent, rgba(196,149,108,0.4), transparent)",
					}}
				/>
				<div
					className="mx-auto h-px max-w-2xl blur-[20px]"
					style={{
						background: "linear-gradient(90deg, transparent, rgba(196,149,108,0.3), transparent)",
					}}
				/>
			</div>

			<footer className="relative mt-12 pb-6 text-left">
				<div className="grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
					<div>
						<div className="flex items-center gap-2.5">
							<svg
								width={24}
								height={24}
								viewBox="0 0 1024 1024"
								xmlns="http://www.w3.org/2000/svg"
								aria-hidden="true"
							>
								<circle cx="440" cy="420" r="51" fill="#f0a060" />
								<circle cx="604" cy="461" r="45" fill="#e07030" />
								<circle cx="491" cy="604" r="41" fill="#f0b070" />
								<circle cx="358" cy="563" r="36" fill="#c05828" opacity="0.88" />
								<circle cx="645" cy="378" r="34" fill="#e07030" />
								<circle cx="512" cy="512" r="70" fill="white" opacity="0.92" />
								<circle cx="512" cy="512" r="42" fill="white" />
							</svg>
							<span className="text-sm font-semibold text-text-primary">{SITE.name}</span>
						</div>
						<p className="mt-3 max-w-xs text-[13px] leading-relaxed text-text-faint">
							{SITE.tagline} The desktop command center for AI coding agents.
						</p>
						<SocialIcons size={16} className="mt-5" />
					</div>

					{FOOTER_NAV.map((col) => (
						<div key={col.heading}>
							<h3 className="text-[11px] font-semibold uppercase tracking-[0.6px] text-text-muted">
								{col.heading}
							</h3>
							<ul className="mt-3 space-y-2">
								{col.links.map((link) => (
									<li key={link.label}>
										<a
											href={link.href}
											{...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
											className="text-[13px] text-text-faint transition-colors hover:text-text-primary"
										>
											{link.label}
										</a>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>

				<div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-[12px] text-text-faint md:flex-row md:items-center">
					<p>
						© {year} {SITE.name}. Built by{" "}
						<a
							href={SITE.github}
							target="_blank"
							rel="noopener noreferrer"
							className="text-text-muted transition-colors hover:text-text-primary"
						>
							Thomas Vrolix
						</a>
						.
					</p>
					<p className="font-mono text-[11px]">
						<a
							href="/changelog"
							className="text-text-muted transition-colors hover:text-text-primary"
						>
							{release?.tagName ?? "latest"}
						</a>
					</p>
				</div>
			</footer>
		</Section>
	);
}
