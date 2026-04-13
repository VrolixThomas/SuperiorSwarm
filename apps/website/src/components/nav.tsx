"use client";

import { SITE } from "@/lib/constants";
import { useRelease } from "@/lib/release-context";
import { useDetectedPlatform } from "@/lib/use-detected-platform";
import { useEffect, useState } from "react";

export function Nav() {
	const [scrolled, setScrolled] = useState(false);
	const platform = useDetectedPlatform();
	const release = useRelease();
	const showDownload = platform === "mac" || platform === "mobile";

	useEffect(() => {
		const onScroll = () => {
			const isScrolled = window.scrollY > 10;
			setScrolled((prev) => (prev === isScrolled ? prev : isScrolled));
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<nav
			className={`fixed top-0 z-50 flex w-full items-center justify-between px-6 py-3 transition-all duration-200 md:px-10 ${
				scrolled
					? "border-b border-border bg-bg-base/80 backdrop-blur-xl"
					: "border-b border-transparent bg-transparent"
			}`}
		>
			<a href="#top" className="flex items-center gap-2.5">
				<svg
					width={30}
					height={30}
					viewBox="0 0 1024 1024"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<circle cx="440" cy="420" r="51" fill="#f0a060" />
					<circle cx="604" cy="461" r="45" fill="#e07030" />
					<circle cx="491" cy="604" r="41" fill="#f0b070" />
					<circle cx="358" cy="563" r="36" fill="#c05828" opacity="0.88" />
					<circle cx="645" cy="378" r="34" fill="#e07030" />
					<circle cx="747" cy="542" r="24" fill="#e07030" opacity="0.7" />
					<circle cx="297" cy="379" r="21" fill="#c05828" opacity="0.6" />
					<circle cx="512" cy="512" r="70" fill="white" opacity="0.92" />
					<circle cx="512" cy="512" r="42" fill="white" />
				</svg>
				<span className="text-sm font-semibold text-text-primary tracking-wide">
					{SITE.name}
				</span>
			</a>
			<div className="flex items-center gap-6">
				<a
					href={SITE.github}
					target="_blank"
					rel="noopener noreferrer"
					className="hidden text-xs text-text-muted transition-colors hover:text-text-secondary md:block"
				>
					GitHub
				</a>
				{showDownload ? (
					<a
						href={release?.dmgUrl ?? SITE.download}
						{...(release?.dmgUrl
							? {}
							: { target: "_blank", rel: "noopener noreferrer" })}
						className="shrink-0 whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-bg-base transition-shadow hover:shadow-[0_0_16px_rgba(196,149,108,0.25)] md:px-4 md:text-xs"
					>
						Download
					</a>
				) : (
					<a
						href="#waitlist"
						className="shrink-0 whitespace-nowrap rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-bg-base transition-shadow hover:shadow-[0_0_16px_rgba(196,149,108,0.25)] md:px-4 md:text-xs"
					>
						Join Waitlist
					</a>
				)}
			</div>
		</nav>
	);
}
