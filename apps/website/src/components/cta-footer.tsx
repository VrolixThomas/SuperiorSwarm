"use client";

import { DownloadButton } from "@/components/download-button";
import { WaitlistForm } from "@/components/waitlist-form";
import { SITE } from "@/lib/constants";
import { useRelease } from "@/lib/release-context";
import { useDetectedPlatform } from "@/lib/use-detected-platform";
import { useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { Section } from "./section";

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

export function CtaFooter() {
	const reduced = useReducedMotion();
	const footerParticles = useMemo(() => generateFooterParticles(), []);
	const platform = useDetectedPlatform();
	const release = useRelease();
	const showDownload = platform === "mac" || platform === "mobile";

	return (
		<Section id="waitlist" label="Join Waitlist" className="text-center">
			{/* Brand glow */}
			<div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse,var(--color-brand-glow)_0%,transparent_70%)]" />

			{/* Particle dispersion above headline */}
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
					<WaitlistForm platform={platform as "windows" | "linux"} />
				)}
			</div>

			{/* Gradient horizon line */}
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

			<footer className="relative mt-8 pb-4">
				<p className="text-sm text-text-faint">
					Built by{" "}
					<a
						href={SITE.github}
						target="_blank"
						rel="noopener noreferrer"
						className="text-text-muted transition-colors hover:text-text-secondary"
					>
						Thomas Vrolix
					</a>
				</p>
			</footer>
		</Section>
	);
}
