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
			{ label: "Waitlist", href: "/#waitlist" },
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
