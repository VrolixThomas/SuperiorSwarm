"use client";

import { DownloadButton } from "@/components/download-button";
import { useRelease } from "@/lib/release-context";
import { shouldShowDownload, useDetectedPlatform } from "@/lib/use-detected-platform";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedLogo } from "./animated-logo";
import { GitHubStarLink } from "./github-stars";
import { WaitlistForm } from "./waitlist-form";

export function Hero() {
	const reduced = useReducedMotion();
	const platform = useDetectedPlatform();
	const release = useRelease();
	const showDownload = shouldShowDownload(platform);

	return (
		<section aria-label="Hero" className="relative overflow-hidden pt-28 pb-8 md:pt-36">
			{/* Enhanced brand glow behind logo */}
			<div className="pointer-events-none absolute -top-10 left-1/2 h-[400px] w-[700px] -translate-x-1/2 bg-[radial-gradient(ellipse,var(--color-brand-glow)_0%,transparent_70%)]" />

			<div className="relative z-10 text-center px-6">
				{/* Animated particle logo */}
				<motion.div
					initial={reduced ? false : { opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 0.4 }}
					className="mb-6 flex justify-center"
				>
					<AnimatedLogo size={140} />
				</motion.div>

				<motion.h1
					initial={reduced ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.2, delay: 0.15 }}
					className="text-5xl font-bold tracking-[-1.5px] text-text-primary md:text-[64px] md:leading-[1.08]"
				>
					Manage your swarm.
					<br />
					<span className="text-accent" style={{ textShadow: "0 0 40px rgba(196,149,108,0.3)" }}>
						Superiorly.
					</span>
				</motion.h1>

				<motion.p
					initial={reduced ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3, delay: 0.25 }}
					className="mx-auto mt-5 max-w-[480px] text-base text-text-secondary md:text-[17px] md:leading-relaxed"
				>
					The desktop command center for AI coding agents. Run agents, review PRs automatically, and
					manage every branch — all from one window.
				</motion.p>

				{/* CTA area */}
				<motion.div
					initial={reduced ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3, delay: 0.35 }}
					className="mt-7 flex flex-col items-center gap-4"
				>
					{showDownload ? (
						<DownloadButton release={release} />
					) : (
						<WaitlistForm platform={platform === "windows" ? "windows" : "linux"} />
					)}
					<GitHubStarLink />
				</motion.div>
			</div>
		</section>
	);
}
