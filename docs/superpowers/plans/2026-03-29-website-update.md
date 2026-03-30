# SuperiorSwarm Website Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the marketing website from a static brochure into an interactive app replica with updated branding (particle swarm logo, muted amber accent), showcasing SuperiorSwarm building itself.

**Architecture:** Replace the 4 static feature sections + static app mockup with one interactive 3-panel app replica that visitors can click through. Sidebar tabs (Repos/Tickets/PRs) switch views. Clicking a PR shows the review panel. Clicking "Fix" on a review finding shows the comment solver. No state management — just `useState` for active view. Mobile gets a stacked single-column layout.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4, Motion (Framer Motion), Geist fonts. No new dependencies.

---

## File Structure

### Files to Create
| File | Responsibility |
|------|---------------|
| `src/components/animated-logo.tsx` | Hero animated particle swarm SVG with reduced-motion fallback |
| `src/components/mockup/mockup-shell.tsx` | macOS window chrome wrapper + 3-panel layout container + mobile layout |
| `src/components/mockup/sidebar.tsx` | Left sidebar: segment control + repos/tickets/PRs views |
| `src/components/mockup/terminal-view.tsx` | Center panel: terminal mockup with tabs and SuperiorSwarm output |
| `src/components/mockup/ticket-board-view.tsx` | Center panel: static Jira-style Kanban board |
| `src/components/mockup/pr-list-view.tsx` | Sidebar: PR list with status badges and reviewer avatars |
| `src/components/mockup/pr-detail-view.tsx` | Center panel: PR overview with file list and diff snippet |
| `src/components/mockup/review-panel.tsx` | Right panel: AI review findings with "Fix" button |
| `src/components/mockup/comment-solver-view.tsx` | Right panel: comment solver grouped fix + approve & push |
| `src/components/mockup/mock-data.ts` | All fake data constants (agents, PRs, tickets, terminal output, review findings) |
| `src/components/feature-cards.tsx` | Three concise highlight cards below the mockup |

### Files to Modify
| File | Changes |
|------|---------|
| `src/app/globals.css` | Update `--color-accent` to `#c4956c`, add `--color-accent-dim`, `--color-brand`, `--color-brand-glow` |
| `src/app/layout.tsx` | Update metadata OG image path |
| `src/app/page.tsx` | Replace feature sections with new component composition |
| `src/components/hero.tsx` | Add animated logo, remove AppMockup, update accent references |
| `src/components/nav.tsx` | Replace Logo with particle swarm SVG, remove "Features" link, update accent references |
| `src/components/cta-footer.tsx` | Update accent color references, glow color |
| `src/components/section.tsx` | Update accent color references |

### Files to Delete
| File | Reason |
|------|--------|
| `src/components/logo.tsx` | Replaced by animated-logo.tsx and inline SVG in nav |
| `src/components/app-mockup.tsx` | Replaced by mockup/ directory |
| `src/components/feature-swarm.tsx` | Replaced by interactive mockup |
| `src/components/feature-review.tsx` | Replaced by interactive mockup |
| `src/components/feature-terminal.tsx` | Replaced by interactive mockup |
| `src/components/feature-integrations.tsx` | Content folded into feature-cards.tsx |
| `src/components/logos/` (entire directory) | Exploration concepts, not used |

### Assets to Copy
| Source | Destination |
|--------|------------|
| `superiorswarm/svg/icon-animated.svg` | `apps/website/public/logo-animated.svg` |
| `superiorswarm/svg/icon-static.svg` | `apps/website/public/logo-static.svg` |
| `superiorswarm/web/favicon.ico` | `apps/website/public/favicon.ico` |
| `superiorswarm/web/favicon-16.png` | `apps/website/public/favicon-16.png` |
| `superiorswarm/web/favicon-32.png` | `apps/website/public/favicon-32.png` |
| `superiorswarm/web/apple-touch-icon.png` | `apps/website/public/apple-touch-icon.png` |
| `superiorswarm/web/og-image-1200x630.png` | `apps/website/public/og-image.png` |

---

## Task 1: Copy brand assets and update globals.css

**Files:**
- Copy: brand assets (see table above)
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Copy brand assets into public/**

```bash
cp superiorswarm/svg/icon-animated.svg apps/website/public/logo-animated.svg
cp superiorswarm/svg/icon-static.svg apps/website/public/logo-static.svg
cp superiorswarm/web/favicon.ico apps/website/public/favicon.ico
cp superiorswarm/web/favicon-16.png apps/website/public/favicon-16.png
cp superiorswarm/web/favicon-32.png apps/website/public/favicon-32.png
cp superiorswarm/web/apple-touch-icon.png apps/website/public/apple-touch-icon.png
cp superiorswarm/web/og-image-1200x630.png apps/website/public/og-image.png
```

- [ ] **Step 2: Update globals.css with new color tokens**

Replace the `@theme` block in `src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
	--color-bg-base: #050507;
	--color-bg-surface: #0d0d10;
	--color-bg-elevated: #111114;
	--color-bg-overlay: #1a1a1e;
	--color-accent: #c4956c;
	--color-accent-dim: rgba(196, 149, 108, 0.12);
	--color-brand: #e07030;
	--color-brand-glow: rgba(224, 112, 48, 0.15);
	--color-text-primary: #f5f5f7;
	--color-text-secondary: #a1a1a6;
	--color-text-muted: #636366;
	--color-text-faint: #48484a;
	--color-border: rgba(255, 255, 255, 0.08);
	--color-green: #28c840;
	--color-yellow: #febc2e;
	--color-red: #ff5f57;
	--color-purple: #c084fc;
	--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	--font-mono: "Geist Mono", "SF Mono", "Fira Code", monospace;
}

/* Focus rings for keyboard navigation */
a:focus-visible,
button:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
	border-radius: 4px;
}
```

- [ ] **Step 3: Update layout.tsx metadata for OG image and favicon**

Add favicon link tags and OG image reference to `src/app/layout.tsx`. Add to the `metadata` export:

```tsx
export const metadata: Metadata = {
	title: `${SITE.name} — ${SITE.tagline}`,
	description: SITE.description,
	icons: {
		icon: [
			{ url: "/favicon.ico", sizes: "any" },
			{ url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
			{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
		],
		apple: "/apple-touch-icon.png",
	},
	openGraph: {
		title: `${SITE.name} — ${SITE.tagline}`,
		description: SITE.description,
		type: "website",
		url: SITE.url,
		images: [{ url: "/og-image.png", width: 1200, height: 630 }],
	},
	twitter: {
		card: "summary_large_image",
		title: `${SITE.name} — ${SITE.tagline}`,
		description: SITE.description,
		images: ["/og-image.png"],
	},
	robots: { index: true, follow: true },
};
```

- [ ] **Step 4: Verify the dev server starts**

```bash
cd apps/website && bun run dev
```

Expected: Dev server starts, page loads with new amber accent color throughout.

- [ ] **Step 5: Commit**

```bash
git add apps/website/public/ apps/website/src/app/globals.css apps/website/src/app/layout.tsx
git commit -m "chore(website): update brand assets and color palette to muted amber"
```

---

## Task 2: Create animated logo and update nav

**Files:**
- Create: `src/components/animated-logo.tsx`
- Modify: `src/components/nav.tsx`
- Delete: `src/components/logo.tsx`

- [ ] **Step 1: Create animated-logo.tsx**

Create `src/components/animated-logo.tsx`. This component renders the particle swarm SVG inline (without the background rect), with a reduced-motion fallback to the static version. Strip the `<rect>` background and `rx="226"` since we want a transparent background on the page.

```tsx
"use client";

import { useReducedMotion } from "motion/react";

export function AnimatedLogo({
	size = 140,
	className = "",
}: {
	size?: number;
	className?: string;
}) {
	const reduced = useReducedMotion();

	if (reduced) {
		return <StaticLogo size={size} className={className} />;
	}

	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 1024 1024"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			aria-hidden="true"
		>
			<defs>
				<filter id="hero-c" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="28" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="hero-lg" x="-80%" y="-80%" width="260%" height="260%">
					<feGaussianBlur stdDeviation="18" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="hero-md" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="11" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="hero-sm" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="7" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>

			{/* OUTER dots — breathe most dramatically */}
			<g style={{ transformOrigin: "512px 512px" }}>
				<animateTransform
					attributeName="transform"
					type="scale"
					values="1;0.28;1"
					keyTimes="0;0.45;1"
					dur="3.2s"
					repeatCount="indefinite"
					calcMode="spline"
					keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
				/>
				<circle cx="829" cy="645" r="17" fill="#e07030" filter="url(#hero-sm)" opacity="0.55">
					<animate attributeName="opacity" values="0.55;0;0.55" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="195" cy="481" r="15" fill="#a04020" opacity="0.45">
					<animate attributeName="opacity" values="0.45;0;0.45" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="624" cy="850" r="16" fill="#f0a060" filter="url(#hero-sm)" opacity="0.48">
					<animate attributeName="opacity" values="0.48;0;0.48" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="850" cy="358" r="14" fill="#e07030" opacity="0.38">
					<animate attributeName="opacity" values="0.38;0;0.38" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="154" cy="563" r="13" fill="#a04020" opacity="0.34">
					<animate attributeName="opacity" values="0.34;0;0.34" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="522" cy="891" r="15" fill="#f0a060" filter="url(#hero-sm)" opacity="0.38">
					<animate attributeName="opacity" values="0.38;0;0.38" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="870" cy="522" r="12" fill="#c05828" opacity="0.28">
					<animate attributeName="opacity" values="0.28;0;0.28" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="317" cy="829" r="11" fill="#a04020" opacity="0.26">
					<animate attributeName="opacity" values="0.26;0;0.26" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
			</g>

			{/* MID dots */}
			<g style={{ transformOrigin: "512px 512px" }}>
				<animateTransform
					attributeName="transform"
					type="scale"
					values="1;0.46;1"
					keyTimes="0;0.45;1"
					dur="3.2s"
					repeatCount="indefinite"
					calcMode="spline"
					keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
				/>
				<circle cx="747" cy="542" r="30" fill="#e07030" filter="url(#hero-md)" opacity="1">
					<animate attributeName="opacity" values="1;0.35;1" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="297" cy="379" r="27" fill="#c05828" filter="url(#hero-md)" opacity="0.82">
					<animate attributeName="opacity" values="0.82;0.2;0.82" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="583" cy="727" r="29" fill="#f0a060" filter="url(#hero-md)" opacity="1">
					<animate attributeName="opacity" values="1;0.3;1" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="707" cy="317" r="25" fill="#f0b070" filter="url(#hero-md)" opacity="1">
					<animate attributeName="opacity" values="1;0.3;1" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="256" cy="624" r="24" fill="#a04020" filter="url(#hero-md)" opacity="0.78">
					<animate attributeName="opacity" values="0.78;0.15;0.78" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="768" cy="420" r="26" fill="#e07030" filter="url(#hero-md)" opacity="1">
					<animate attributeName="opacity" values="1;0.3;1" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
				<circle cx="399" cy="747" r="23" fill="#c05828" filter="url(#hero-md)" opacity="0.72">
					<animate attributeName="opacity" values="0.72;0.15;0.72" keyTimes="0;0.45;1" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
				</circle>
			</g>

			{/* INNER cluster — least movement */}
			<g style={{ transformOrigin: "512px 512px" }}>
				<animateTransform
					attributeName="transform"
					type="scale"
					values="1;0.62;1"
					keyTimes="0;0.45;1"
					dur="3.2s"
					repeatCount="indefinite"
					calcMode="spline"
					keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
				/>
				<circle cx="440" cy="420" r="51" fill="#f0a060" filter="url(#hero-lg)" />
				<circle cx="604" cy="461" r="45" fill="#e07030" filter="url(#hero-lg)" />
				<circle cx="491" cy="604" r="41" fill="#f0b070" filter="url(#hero-lg)" />
				<circle cx="358" cy="563" r="36" fill="#c05828" opacity="0.88" filter="url(#hero-lg)" />
				<circle cx="645" cy="378" r="34" fill="#e07030" filter="url(#hero-lg)" />
			</g>

			{/* CORE — static */}
			<circle cx="512" cy="512" r="87" fill="white" opacity="0.92" filter="url(#hero-c)" />
			<circle cx="512" cy="512" r="49" fill="white" />
		</svg>
	);
}

function StaticLogo({ size, className }: { size: number; className: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 1024 1024"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			aria-hidden="true"
		>
			<defs>
				<filter id="hero-sc" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="28" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="hero-slg" x="-80%" y="-80%" width="260%" height="260%">
					<feGaussianBlur stdDeviation="18" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="hero-smd" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="11" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter id="hero-ssm" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="7" result="b" />
					<feMerge>
						<feMergeNode in="b" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>
			<circle cx="440" cy="420" r="51" fill="#f0a060" filter="url(#hero-slg)" />
			<circle cx="604" cy="461" r="45" fill="#e07030" filter="url(#hero-slg)" />
			<circle cx="491" cy="604" r="41" fill="#f0b070" filter="url(#hero-slg)" />
			<circle cx="358" cy="563" r="36" fill="#c05828" opacity="0.88" filter="url(#hero-slg)" />
			<circle cx="645" cy="378" r="34" fill="#e07030" filter="url(#hero-slg)" />
			<circle cx="747" cy="542" r="30" fill="#e07030" filter="url(#hero-smd)" />
			<circle cx="297" cy="379" r="27" fill="#c05828" opacity="0.82" filter="url(#hero-smd)" />
			<circle cx="583" cy="727" r="29" fill="#f0a060" filter="url(#hero-smd)" />
			<circle cx="707" cy="317" r="25" fill="#f0b070" filter="url(#hero-smd)" />
			<circle cx="256" cy="624" r="24" fill="#a04020" opacity="0.78" filter="url(#hero-smd)" />
			<circle cx="768" cy="420" r="26" fill="#e07030" filter="url(#hero-smd)" />
			<circle cx="399" cy="747" r="23" fill="#c05828" opacity="0.72" filter="url(#hero-smd)" />
			<circle cx="829" cy="645" r="17" fill="#e07030" opacity="0.55" filter="url(#hero-ssm)" />
			<circle cx="195" cy="481" r="15" fill="#a04020" opacity="0.45" />
			<circle cx="624" cy="850" r="16" fill="#f0a060" opacity="0.48" filter="url(#hero-ssm)" />
			<circle cx="850" cy="358" r="14" fill="#e07030" opacity="0.38" />
			<circle cx="154" cy="563" r="13" fill="#a04020" opacity="0.34" />
			<circle cx="522" cy="891" r="15" fill="#f0a060" opacity="0.38" filter="url(#hero-ssm)" />
			<circle cx="870" cy="522" r="12" fill="#c05828" opacity="0.28" />
			<circle cx="317" cy="829" r="11" fill="#a04020" opacity="0.26" />
			<circle cx="512" cy="512" r="87" fill="white" opacity="0.92" filter="url(#hero-sc)" />
			<circle cx="512" cy="512" r="49" fill="white" />
		</svg>
	);
}
```

- [ ] **Step 2: Update nav.tsx — replace Logo import with inline nav-sized particle swarm**

Replace the full content of `src/components/nav.tsx`:

```tsx
"use client";

import { SITE } from "@/lib/constants";
import { useEffect, useState } from "react";

export function Nav() {
	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 10);
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<nav
			className={`fixed top-0 z-50 flex w-full items-center justify-between px-6 py-3.5 transition-colors duration-200 md:px-10 ${
				scrolled ? "bg-bg-base/80 backdrop-blur-xl" : "bg-transparent"
			}`}
		>
			<a href="#top" className="flex items-center gap-2.5">
				<svg
					width={22}
					height={22}
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
			<div className="flex items-center gap-7">
				<a
					href={SITE.github}
					target="_blank"
					rel="noopener noreferrer"
					className="hidden text-xs text-text-muted transition-colors hover:text-text-secondary md:block"
				>
					GitHub
				</a>
				<a
					href={SITE.download}
					target="_blank"
					rel="noopener noreferrer"
					className="text-xs font-medium text-text-primary transition-colors hover:text-accent"
				>
					Download
				</a>
			</div>
		</nav>
	);
}
```

- [ ] **Step 3: Delete logo.tsx**

```bash
rm apps/website/src/components/logo.tsx
```

- [ ] **Step 4: Verify nav renders with new logo**

Run dev server, check the nav shows the particle swarm icon at 22px with "SuperiorSwarm" wordmark. Links should show muted amber on hover.

- [ ] **Step 5: Commit**

```bash
git add apps/website/src/components/animated-logo.tsx apps/website/src/components/nav.tsx
git rm apps/website/src/components/logo.tsx
git commit -m "feat(website): add animated particle logo and update nav branding"
```

---

## Task 3: Update hero section with animated logo

**Files:**
- Modify: `src/components/hero.tsx`

- [ ] **Step 1: Rewrite hero.tsx**

Replace the full content of `src/components/hero.tsx`:

```tsx
"use client";

import { SITE } from "@/lib/constants";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedLogo } from "./animated-logo";

export function Hero() {
	const reduced = useReducedMotion();
	return (
		<section aria-label="Hero" className="relative overflow-hidden pt-28 pb-8 md:pt-36">
			{/* Brand glow behind logo */}
			<div className="pointer-events-none absolute -top-5 left-1/2 h-[300px] w-[600px] -translate-x-1/2 bg-[radial-gradient(ellipse,var(--color-brand-glow)_0%,transparent_70%)]" />

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
					className="text-4xl font-bold tracking-[-1.5px] text-text-primary md:text-[56px] md:leading-[1.08]"
				>
					Manage your swarm.
					<br />
					<span className="text-accent">Superiorly.</span>
				</motion.h1>

				<motion.p
					initial={reduced ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3, delay: 0.25 }}
					className="mx-auto mt-4 max-w-[480px] text-base text-text-secondary md:text-[17px] md:leading-relaxed"
				>
					The desktop command center for AI coding agents. Run agents, review PRs automatically,
					and manage every branch — all from one window.
				</motion.p>

				{/* CTAs */}
				<motion.div
					initial={reduced ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3, delay: 0.35 }}
					className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-7"
				>
					<a
						href={SITE.download}
						target="_blank"
						rel="noopener noreferrer"
						className="text-[17px] text-accent transition-opacity hover:opacity-80"
					>
						Download for Mac ›
					</a>
					<a
						href={SITE.github}
						target="_blank"
						rel="noopener noreferrer"
						className="text-[17px] text-accent transition-opacity hover:opacity-80"
					>
						Star on GitHub ›
					</a>
				</motion.div>

				<motion.p
					initial={reduced ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3, delay: 0.4 }}
					className="mt-2 text-[11px] text-text-faint"
				>
					Free & open source · macOS
				</motion.p>
			</div>
		</section>
	);
}
```

- [ ] **Step 2: Verify hero renders with animated logo**

Check that the animated particle logo appears centered above the headline, breathing animation plays, and the brand glow is visible behind it.

- [ ] **Step 3: Commit**

```bash
git add apps/website/src/components/hero.tsx
git commit -m "feat(website): add animated particle logo to hero section"
```

---

## Task 4: Create mock data

**Files:**
- Create: `src/components/mockup/mock-data.ts`

- [ ] **Step 1: Create mock-data.ts with all fake data**

Create `src/components/mockup/mock-data.ts`:

```ts
export const PROJECTS = [
	{ name: "SuperiorSwarm", color: "#c4956c", active: true },
	{ name: "relay-api", color: "#636366", active: false },
	{ name: "docs", color: "#636366", active: false },
] as const;

export const AGENTS = [
	{
		name: "Claude Code",
		branch: "feature/ticket-board",
		status: "Implementing drag-and-drop",
		color: "green" as const,
	},
	{
		name: "PR Review Agent",
		branch: "PR #28",
		status: "Reviewing changes",
		color: "accent" as const,
	},
	{
		name: "Codex",
		branch: "fix/oauth-refresh",
		status: "Fixing token expiry",
		color: "purple" as const,
	},
] as const;

export const PULL_REQUESTS = [
	{
		id: 28,
		title: "Make PR section similar to repo workspaces",
		branch: "feature/pr-section",
		target: "main",
		author: "TV",
		authorColor: "#c4956c",
		ci: "success" as const,
		reviewDecision: "APPROVED" as const,
		reviewers: [
			{ initials: "AI", decision: "approved" as const },
			{ initials: "JD", decision: "approved" as const },
		],
		comments: 3,
		files: [
			{ name: "src/renderer/components/PullRequestsTab.tsx", additions: 142, deletions: 38 },
			{ name: "src/renderer/components/PRCard.tsx", additions: 67, deletions: 12 },
			{ name: "src/renderer/components/PROverviewTab.tsx", additions: 31, deletions: 8 },
		],
	},
	{
		id: 27,
		title: "Add drag-and-drop ticket board",
		branch: "feature/ticket-board",
		target: "main",
		author: "TV",
		authorColor: "#c4956c",
		ci: "pending" as const,
		reviewDecision: null,
		reviewers: [],
		comments: 0,
		files: [],
	},
	{
		id: 25,
		title: "Fix OAuth token refresh race condition",
		branch: "fix/oauth-refresh",
		target: "main",
		author: "TV",
		authorColor: "#c4956c",
		ci: "success" as const,
		reviewDecision: "CHANGES_REQUESTED" as const,
		reviewers: [{ initials: "AI", decision: "changes_requested" as const }],
		comments: 5,
		files: [],
	},
] as const;

export const REVIEW_FINDINGS = [
	{
		type: "warning" as const,
		icon: "⚠",
		file: "PullRequestsTab.tsx",
		line: 84,
		message:
			"Missing error boundary around PRCard render — unhandled rejection in fetchPRDetails could crash the component tree",
		fixable: true,
	},
	{
		type: "approval" as const,
		icon: "✓",
		file: "PRCard.tsx",
		line: null,
		message: "Good component decomposition — PRCard extracted cleanly with proper prop typing",
		fixable: false,
	},
	{
		type: "suggestion" as const,
		icon: "ℹ",
		file: "PullRequestsTab.tsx",
		line: 42,
		message: "Consider adding a loading skeleton while PR enrichment data is being fetched",
		fixable: false,
	},
] as const;

export const SOLVER_FIX = {
	groupLabel: "Add ErrorBoundary wrapper around PRCard list",
	commitHash: "a3f7b2c",
	file: "PullRequestsTab.tsx",
	diff: [
		{ type: "context" as const, content: "  return (" },
		{ type: "context" as const, content: "    <div className=\"flex flex-col gap-1\">" },
		{ type: "add" as const, content: "      <ErrorBoundary fallback={<PRListError />}>" },
		{ type: "context" as const, content: "        {pullRequests.map((pr) => (" },
		{ type: "context" as const, content: "          <PRCard key={pr.id} pr={pr} />" },
		{ type: "context" as const, content: "        ))}" },
		{ type: "add" as const, content: "      </ErrorBoundary>" },
		{ type: "context" as const, content: "    </div>" },
		{ type: "context" as const, content: "  );" },
	],
	reply:
		"Added an error boundary around the PR card list to catch potential fetch failures. LGTM otherwise.",
} as const;

export const TICKETS = [
	{ key: "SS-41", title: "Drag-and-drop ticket board", status: "IN PROGRESS" as const },
	{ key: "SS-40", title: "PR enrichment: mergeable state", status: "IN PROGRESS" as const },
	{ key: "SS-39", title: "Terminal scrollback persistence", status: "TODO" as const },
	{ key: "SS-38", title: "Linear team selection UI", status: "TODO" as const },
	{ key: "SS-37", title: "Review draft follow-up rounds", status: "IN REVIEW" as const },
	{ key: "SS-36", title: "Worktree shared files", status: "DONE" as const },
	{ key: "SS-35", title: "Supabase auth integration", status: "DONE" as const },
	{ key: "SS-34", title: "Comment solver revert flow", status: "DONE" as const },
] as const;

export const TERMINAL_LINES = [
	{ type: "prompt" as const, path: "~/SuperiorSwarm", branch: "feature/ticket-board" },
	{ type: "command" as const, text: "bun run dev" },
	{ type: "output" as const, text: "$ turbo run dev" },
	{ type: "output" as const, text: "• Packages in scope: superiorswarm" },
	{ type: "success" as const, text: "✓ electron-vite dev server running" },
	{ type: "output" as const, text: "  ➜ Local: http://localhost:5173/" },
	{ type: "output" as const, text: "  ➜ Electron: ready in 1.2s" },
	{ type: "info" as const, text: "[HMR] connected" },
	{ type: "blank" as const },
	{ type: "prompt" as const, path: "~/SuperiorSwarm", branch: "feature/ticket-board" },
	{ type: "cursor" as const },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/mockup/mock-data.ts
git commit -m "feat(website): add mock data for interactive app mockup"
```

---

## Task 5: Build the mockup shell and sidebar

**Files:**
- Create: `src/components/mockup/mockup-shell.tsx`
- Create: `src/components/mockup/sidebar.tsx`

- [ ] **Step 1: Create mockup-shell.tsx**

Create `src/components/mockup/mockup-shell.tsx`. This is the outer container with macOS window chrome and the 3-panel responsive layout. It manages which view is active via a simple `useState`.

```tsx
"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TerminalView } from "./terminal-view";
import { TicketBoardView } from "./ticket-board-view";
import { PrDetailView } from "./pr-detail-view";
import { ReviewPanel } from "./review-panel";
import { CommentSolverView } from "./comment-solver-view";

export type Segment = "repos" | "tickets" | "prs";
export type RightPanel = "review" | "solver" | "hidden";

export function MockupShell() {
	const [segment, setSegment] = useState<Segment>("repos");
	const [selectedPr, setSelectedPr] = useState<number | null>(null);
	const [rightPanel, setRightPanel] = useState<RightPanel>("hidden");

	function handleSegmentChange(s: Segment) {
		setSegment(s);
		setSelectedPr(null);
		setRightPanel("hidden");
	}

	function handlePrSelect(prId: number) {
		setSelectedPr(prId);
		setRightPanel("review");
	}

	function handleFixClick() {
		setRightPanel("solver");
	}

	const showRightPanel = segment === "prs" && selectedPr !== null && rightPanel !== "hidden";

	return (
		<div
			className="mx-auto max-w-[1060px] px-4 md:px-8"
			role="region"
			aria-label="Interactive preview of SuperiorSwarm desktop app"
		>
			<div className="overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-[0_40px_100px_rgba(0,0,0,0.6)]">
				{/* macOS window chrome */}
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					<div className="flex items-center gap-1.5">
						<div className="size-2.5 rounded-full bg-red" />
						<div className="size-2.5 rounded-full bg-yellow" />
						<div className="size-2.5 rounded-full bg-green" />
					</div>
					<span className="text-[11px] text-text-muted">SuperiorSwarm</span>
					<div className="flex items-center gap-1.5">
						<span className="relative flex size-2">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-green opacity-40" />
							<span className="relative inline-flex size-2 rounded-full bg-green" />
						</span>
						<span className="text-[10px] text-text-muted">3 agents</span>
					</div>
				</div>

				{/* Mobile tab bar */}
				<div className="flex border-b border-border md:hidden">
					{(["repos", "tickets", "prs"] as const).map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => handleSegmentChange(s)}
							className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
								segment === s
									? "border-b-2 border-accent text-accent"
									: "text-text-muted"
							}`}
						>
							{s === "prs" ? "PRs" : s}
						</button>
					))}
				</div>

				{/* Desktop 3-panel layout */}
				<div className="hidden md:flex" style={{ height: 480 }}>
					{/* Left sidebar */}
					<div className="w-[220px] shrink-0 border-r border-border bg-bg-surface overflow-y-auto">
						<Sidebar
							segment={segment}
							onSegmentChange={handleSegmentChange}
							selectedPr={selectedPr}
							onPrSelect={handlePrSelect}
						/>
					</div>

					{/* Center panel */}
					<div className="flex min-w-0 flex-1 flex-col bg-bg-base">
						{segment === "repos" && <TerminalView />}
						{segment === "tickets" && <TicketBoardView />}
						{segment === "prs" && selectedPr !== null && <PrDetailView prId={selectedPr} />}
						{segment === "prs" && selectedPr === null && (
							<div className="flex flex-1 items-center justify-center text-xs text-text-faint">
								Select a PR to view details
							</div>
						)}
					</div>

					{/* Right panel */}
					{showRightPanel && (
						<div className="w-[300px] shrink-0 border-l border-border bg-bg-surface overflow-y-auto">
							{rightPanel === "review" && (
								<ReviewPanel prId={selectedPr!} onFixClick={handleFixClick} />
							)}
							{rightPanel === "solver" && <CommentSolverView />}
						</div>
					)}
				</div>

				{/* Mobile stacked layout */}
				<div className="md:hidden">
					{segment === "repos" && (
						<>
							<Sidebar
								segment="repos"
								onSegmentChange={handleSegmentChange}
								selectedPr={null}
								onPrSelect={handlePrSelect}
								mobile
							/>
							<div className="border-t border-border">
								<TerminalView />
							</div>
						</>
					)}
					{segment === "tickets" && <TicketBoardView />}
					{segment === "prs" && (
						<>
							<Sidebar
								segment="prs"
								onSegmentChange={handleSegmentChange}
								selectedPr={selectedPr}
								onPrSelect={handlePrSelect}
								mobile
							/>
							{selectedPr !== null && (
								<>
									<div className="border-t border-border">
										<PrDetailView prId={selectedPr} />
									</div>
									<div className="border-t border-border">
										{rightPanel === "solver" ? (
											<CommentSolverView />
										) : (
											<ReviewPanel prId={selectedPr} onFixClick={handleFixClick} />
										)}
									</div>
								</>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Create sidebar.tsx**

Create `src/components/mockup/sidebar.tsx`:

```tsx
import type { Segment } from "./mockup-shell";
import { AGENTS, PROJECTS, PULL_REQUESTS } from "./mock-data";

const DOT_COLORS: Record<string, string> = {
	green: "bg-green",
	accent: "bg-accent",
	purple: "bg-purple",
};

const BORDER_COLORS: Record<string, string> = {
	green: "border-green/20",
	accent: "border-accent/20",
	purple: "border-purple/20",
};

const CI_ICONS: Record<string, { icon: string; color: string }> = {
	success: { icon: "✓", color: "text-green" },
	pending: { icon: "⦿", color: "text-yellow" },
	failure: { icon: "✗", color: "text-red" },
};

const DECISION_COLORS: Record<string, string> = {
	approved: "text-green",
	changes_requested: "text-red",
};

export function Sidebar({
	segment,
	onSegmentChange,
	selectedPr,
	onPrSelect,
	mobile = false,
}: {
	segment: Segment;
	onSegmentChange: (s: Segment) => void;
	selectedPr: number | null;
	onPrSelect: (id: number) => void;
	mobile?: boolean;
}) {
	return (
		<div className="p-2.5">
			{/* Segment control — desktop only */}
			{!mobile && (
				<div className="mb-3 flex rounded-md border border-border bg-bg-elevated p-0.5">
					{(["repos", "tickets", "prs"] as const).map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => onSegmentChange(s)}
							className={`flex-1 rounded-[3px] py-1 text-[10px] font-medium capitalize transition-colors ${
								segment === s
									? "bg-bg-overlay text-text-primary"
									: "text-text-muted hover:text-text-secondary"
							}`}
						>
							{s === "prs" ? "PRs" : s}
						</button>
					))}
				</div>
			)}

			{segment === "repos" && <ReposView />}
			{segment === "prs" && (
				<PrsView selectedPr={selectedPr} onPrSelect={onPrSelect} />
			)}
		</div>
	);
}

function ReposView() {
	return (
		<>
			<SidebarLabel>Projects</SidebarLabel>
			<div className="mb-4 flex flex-col gap-0.5">
				{PROJECTS.map((p) => (
					<div
						key={p.name}
						className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
							p.active ? "bg-bg-overlay" : ""
						}`}
					>
						<span
							className="size-1.5 rounded-full"
							style={{ backgroundColor: p.color }}
						/>
						<span
							className={`text-[11px] ${
								p.active ? "font-medium text-text-primary" : "text-text-secondary"
							}`}
						>
							{p.name}
						</span>
					</div>
				))}
			</div>

			<SidebarLabel>Active Agents</SidebarLabel>
			<div className="flex flex-col gap-1.5">
				{AGENTS.map((agent) => (
					<div
						key={agent.name}
						className={`rounded-md border ${BORDER_COLORS[agent.color]} bg-bg-elevated p-2`}
					>
						<div className="flex items-center gap-1.5">
							<span className="relative flex size-1.5">
								<span
									className={`absolute inline-flex size-full animate-ping rounded-full ${DOT_COLORS[agent.color]} opacity-40`}
								/>
								<span
									className={`relative inline-flex size-1.5 rounded-full ${DOT_COLORS[agent.color]}`}
								/>
							</span>
							<span className="text-[10px] font-medium text-text-primary">
								{agent.name}
							</span>
						</div>
						<p className="mt-1 pl-3 text-[9px] text-text-muted">
							{agent.branch} — {agent.status}
						</p>
					</div>
				))}
			</div>
		</>
	);
}

function PrsView({
	selectedPr,
	onPrSelect,
}: {
	selectedPr: number | null;
	onPrSelect: (id: number) => void;
}) {
	return (
		<>
			<SidebarLabel>Pull Requests</SidebarLabel>
			<div className="flex flex-col gap-1">
				{PULL_REQUESTS.map((pr) => {
					const ci = CI_ICONS[pr.ci];
					return (
						<button
							key={pr.id}
							type="button"
							onClick={() => onPrSelect(pr.id)}
							className={`w-full rounded-md border p-2 text-left transition-colors ${
								selectedPr === pr.id
									? "border-accent/30 bg-bg-overlay"
									: "border-transparent hover:bg-bg-elevated"
							}`}
						>
							<div className="flex items-center gap-1.5">
								<span className={`text-[9px] ${ci.color}`}>{ci.icon}</span>
								<span className="flex-1 truncate text-[11px] font-medium text-text-primary">
									#{pr.id} {pr.title}
								</span>
							</div>
							<div className="mt-1 flex items-center gap-2 pl-3">
								<span className="text-[9px] text-text-faint">
									{pr.branch} → {pr.target}
								</span>
							</div>
							{pr.reviewers.length > 0 && (
								<div className="mt-1 flex items-center gap-1 pl-3">
									{pr.reviewers.map((r) => (
										<span
											key={r.initials}
											className={`text-[8px] font-medium ${DECISION_COLORS[r.decision] ?? "text-text-faint"}`}
										>
											{r.initials}
											{r.decision === "approved" ? " ✓" : r.decision === "changes_requested" ? " ✗" : ""}
										</span>
									))}
									{pr.comments > 0 && (
										<span className="text-[8px] text-text-faint">
											· {pr.comments} comments
										</span>
									)}
								</div>
							)}
						</button>
					);
				})}
			</div>
		</>
	);
}

function SidebarLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="mb-1.5 px-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-faint">
			{children}
		</p>
	);
}
```

- [ ] **Step 3: Verify sidebar renders in both segments**

The sidebar is not yet mounted in the page — this is just a build check. Verify no TypeScript errors:

```bash
cd apps/website && bun run type-check
```

Expected: passes (or only errors from missing mockup components that haven't been created yet — those are imported in mockup-shell but not yet created).

- [ ] **Step 4: Commit**

```bash
git add apps/website/src/components/mockup/mockup-shell.tsx apps/website/src/components/mockup/sidebar.tsx
git commit -m "feat(website): add mockup shell and sidebar components"
```

---

## Task 6: Build center panel views (terminal, tickets, PR detail)

**Files:**
- Create: `src/components/mockup/terminal-view.tsx`
- Create: `src/components/mockup/ticket-board-view.tsx`
- Create: `src/components/mockup/pr-detail-view.tsx`

- [ ] **Step 1: Create terminal-view.tsx**

Create `src/components/mockup/terminal-view.tsx`:

```tsx
import { TERMINAL_LINES } from "./mock-data";

export function TerminalView() {
	return (
		<div className="flex flex-1 flex-col">
			{/* Tab bar */}
			<div className="flex items-center gap-0 border-b border-border">
				<div className="flex items-center gap-1.5 border-b-2 border-accent px-3 py-1.5">
					<span className="text-[10px] text-accent">●</span>
					<span className="text-[11px] font-medium text-accent">zsh</span>
				</div>
				<div className="flex items-center gap-1.5 px-3 py-1.5">
					<span className="relative flex size-1.5">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-green opacity-40" />
						<span className="relative inline-flex size-1.5 rounded-full bg-green" />
					</span>
					<span className="text-[11px] text-green">claude</span>
				</div>
				<div className="flex items-center gap-1.5 px-3 py-1.5">
					<span className="text-[11px] text-text-muted">bun dev</span>
				</div>
			</div>

			{/* Terminal output */}
			<div className="flex-1 overflow-hidden p-3">
				<pre className="font-mono text-[11px] leading-[1.7]">
					{TERMINAL_LINES.map((line, i) => {
						switch (line.type) {
							case "prompt":
								return (
									<span key={i}>
										<span className="text-accent">{line.path}</span>
										<span className="text-text-muted"> on </span>
										<span className="text-purple">{line.branch}</span>
										{"\n"}
									</span>
								);
							case "command":
								return (
									<span key={i}>
										<span className="text-green">❯</span>
										<span className="text-text-primary"> {line.text}</span>
										{"\n"}
									</span>
								);
							case "output":
								return (
									<span key={i}>
										<span className="text-text-muted">{line.text}</span>
										{"\n"}
									</span>
								);
							case "success":
								return (
									<span key={i}>
										<span className="text-green">{line.text}</span>
										{"\n"}
									</span>
								);
							case "info":
								return (
									<span key={i}>
										<span className="text-accent">{line.text}</span>
										{"\n"}
									</span>
								);
							case "blank":
								return <span key={i}>{"\n"}</span>;
							case "cursor":
								return (
									<span key={i}>
										<span className="text-green">❯</span>
										<span className="animate-pulse text-text-primary"> █</span>
									</span>
								);
							default:
								return null;
						}
					})}
				</pre>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Create ticket-board-view.tsx**

Create `src/components/mockup/ticket-board-view.tsx`:

```tsx
import { TICKETS } from "./mock-data";

const COLUMNS = ["TODO", "IN PROGRESS", "IN REVIEW", "DONE"] as const;

const COLUMN_DOT: Record<string, string> = {
	TODO: "bg-text-faint",
	"IN PROGRESS": "bg-accent",
	"IN REVIEW": "bg-purple",
	DONE: "bg-green",
};

export function TicketBoardView() {
	return (
		<div className="flex flex-1 gap-2 overflow-x-auto p-3">
			{COLUMNS.map((col) => {
				const tickets = TICKETS.filter((t) => t.status === col);
				return (
					<div key={col} className="flex w-[160px] shrink-0 flex-col">
						<div className="mb-2 flex items-center gap-1.5 px-1">
							<span className={`size-1.5 rounded-full ${COLUMN_DOT[col]}`} />
							<span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-faint">
								{col}
							</span>
							<span className="text-[9px] text-text-faint">{tickets.length}</span>
						</div>
						<div className="flex flex-col gap-1.5">
							{tickets.map((t) => (
								<div
									key={t.key}
									className="rounded-md border border-border bg-bg-surface p-2"
								>
									<p className="text-[10px] font-medium text-text-primary">{t.title}</p>
									<p className="mt-1 text-[9px] text-text-faint">{t.key}</p>
								</div>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 3: Create pr-detail-view.tsx**

Create `src/components/mockup/pr-detail-view.tsx`:

```tsx
import { PULL_REQUESTS } from "./mock-data";

export function PrDetailView({ prId }: { prId: number }) {
	const pr = PULL_REQUESTS.find((p) => p.id === prId);
	if (!pr) return null;

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{/* PR header */}
			<div className="border-b border-border px-4 py-3">
				<h3 className="text-[14px] font-semibold text-text-primary">{pr.title}</h3>
				<div className="mt-1 flex items-center gap-2">
					<span className="text-[10px] text-text-faint">#{pr.id}</span>
					<span className="text-[10px] text-text-faint">·</span>
					<span className="font-mono text-[10px] text-text-muted">
						{pr.branch} → {pr.target}
					</span>
				</div>
				<div className="mt-2 flex items-center gap-2">
					{pr.reviewDecision === "APPROVED" && (
						<span className="rounded-full bg-green/10 px-2 py-0.5 text-[9px] font-medium text-green">
							✓ Approved
						</span>
					)}
					{pr.reviewDecision === "CHANGES_REQUESTED" && (
						<span className="rounded-full bg-red/10 px-2 py-0.5 text-[9px] font-medium text-red">
							✗ Changes requested
						</span>
					)}
					{pr.ci === "success" && (
						<span className="rounded-full bg-green/10 px-2 py-0.5 text-[9px] font-medium text-green">
							✓ CI passed
						</span>
					)}
					{pr.ci === "pending" && (
						<span className="rounded-full bg-yellow/10 px-2 py-0.5 text-[9px] font-medium text-yellow">
							⦿ CI pending
						</span>
					)}
				</div>
			</div>

			{/* File list */}
			{pr.files.length > 0 && (
				<div className="px-4 py-3">
					<p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-faint">
						Files changed ({pr.files.length})
					</p>
					<div className="flex flex-col gap-1">
						{pr.files.map((f) => (
							<div
								key={f.name}
								className="flex items-center justify-between rounded-md bg-bg-elevated px-2.5 py-1.5"
							>
								<span className="truncate font-mono text-[10px] text-text-secondary">
									{f.name}
								</span>
								<div className="flex items-center gap-1.5 pl-2">
									<span className="text-[9px] text-green">+{f.additions}</span>
									<span className="text-[9px] text-red">-{f.deletions}</span>
								</div>
							</div>
						))}
					</div>

					{/* Diff preview */}
					<div className="mt-3 rounded-md border border-border bg-bg-base p-2.5">
						<p className="mb-1.5 font-mono text-[9px] text-text-faint">
							PullRequestsTab.tsx
						</p>
						<pre className="font-mono text-[10px] leading-[1.7]">
							<span className="text-text-faint">{"@@ -82,4 +82,8 @@"}</span>
							{"\n"}
							<span className="text-text-muted">{"  const enriched = usePREnrichment(pr);"}</span>
							{"\n"}
							<span className="text-text-muted">{"  "}</span>
							{"\n"}
							<span className="text-text-muted">{"  return ("}</span>
							{"\n"}
							<span className="text-green">{"+   <ErrorBoundary fallback={<PRListError />}>"}</span>
							{"\n"}
							<span className="text-text-muted">{"      <div className=\"flex flex-col gap-1\">"}</span>
							{"\n"}
							<span className="text-text-muted">{"        {pullRequests.map((pr) => ("}</span>
							{"\n"}
							<span className="text-text-muted">{"          <PRCard key={pr.id} pr={pr} />"}</span>
							{"\n"}
							<span className="text-green">{"+   </ErrorBoundary>"}</span>
						</pre>
					</div>
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/website/src/components/mockup/terminal-view.tsx apps/website/src/components/mockup/ticket-board-view.tsx apps/website/src/components/mockup/pr-detail-view.tsx
git commit -m "feat(website): add terminal, ticket board, and PR detail views"
```

---

## Task 7: Build right panel views (review panel, comment solver)

**Files:**
- Create: `src/components/mockup/review-panel.tsx`
- Create: `src/components/mockup/comment-solver-view.tsx`

- [ ] **Step 1: Create review-panel.tsx**

Create `src/components/mockup/review-panel.tsx`:

```tsx
import { REVIEW_FINDINGS } from "./mock-data";

const TYPE_STYLES: Record<string, { iconColor: string }> = {
	warning: { iconColor: "text-yellow" },
	approval: { iconColor: "text-green" },
	suggestion: { iconColor: "text-accent" },
};

export function ReviewPanel({
	prId,
	onFixClick,
}: {
	prId: number;
	onFixClick: () => void;
}) {
	return (
		<div className="p-3">
			{/* Header */}
			<div className="mb-3 flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<span className="relative flex size-1.5">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-green opacity-40" />
						<span className="relative inline-flex size-1.5 rounded-full bg-green" />
					</span>
					<span className="text-[11px] font-medium text-text-primary">AI Review</span>
				</div>
				<span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-medium text-green">
					Ready
				</span>
			</div>

			{/* PR reference */}
			<p className="mb-3 text-[10px] text-text-muted">
				PR #{prId} — 3 findings
			</p>

			{/* Findings */}
			<div className="flex flex-col gap-2">
				{REVIEW_FINDINGS.map((finding, i) => {
					const style = TYPE_STYLES[finding.type];
					return (
						<div
							key={i}
							className="rounded-lg border border-border bg-bg-elevated p-2.5"
						>
							<div className="flex items-start gap-2">
								<span className={`mt-px text-xs ${style.iconColor}`}>
									{finding.icon}
								</span>
								<div className="flex-1">
									<p className="text-[10px] font-medium text-text-secondary">
										{finding.file}
										{finding.line && (
											<span className="text-text-faint">:{finding.line}</span>
										)}
									</p>
									<p className="mt-0.5 text-[10px] text-text-muted">
										{finding.message}
									</p>
									{finding.fixable && (
										<button
											type="button"
											onClick={onFixClick}
											className="mt-2 rounded bg-accent-dim px-2 py-0.5 text-[10px] font-medium text-accent transition-colors hover:bg-accent/20"
										>
											Fix →
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Create comment-solver-view.tsx**

Create `src/components/mockup/comment-solver-view.tsx`:

```tsx
import { SOLVER_FIX } from "./mock-data";

export function CommentSolverView() {
	return (
		<div className="flex flex-col">
			{/* Header */}
			<div className="border-b border-border px-3 py-2.5">
				<div className="flex items-center gap-1.5">
					<span className="text-[11px] font-medium text-text-primary">Comment Solver</span>
					<span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-medium text-green">
						Fix ready
					</span>
				</div>
				<p className="mt-0.5 text-[9px] text-text-faint">PR #28 · 1 group · 1 fix</p>
			</div>

			{/* Fix group */}
			<div className="p-3">
				<div className="rounded-lg border border-border bg-bg-elevated">
					{/* Group header */}
					<div className="flex items-center justify-between border-b border-border px-3 py-2">
						<div className="flex items-center gap-1.5">
							<span className="size-1.5 rounded-full bg-green" />
							<span className="text-[10px] font-medium text-text-primary">
								{SOLVER_FIX.groupLabel}
							</span>
						</div>
						<span className="rounded bg-green/15 px-1.5 py-0.5 text-[8px] font-medium text-green">
							1/1 fixed
						</span>
					</div>

					{/* Commit info */}
					<div className="border-b border-border px-3 py-1.5">
						<span className="font-mono text-[9px] text-text-faint">
							commit {SOLVER_FIX.commitHash} · {SOLVER_FIX.file}
						</span>
					</div>

					{/* Diff */}
					<div className="px-3 py-2">
						<pre className="font-mono text-[9px] leading-[1.7]">
							{SOLVER_FIX.diff.map((line, i) => {
								const color =
									line.type === "add"
										? "text-green"
										: line.type === "remove"
											? "text-red"
											: "text-text-muted";
								const prefix =
									line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
								return (
									<span key={i}>
										<span className={color}>
											{prefix} {line.content}
										</span>
										{"\n"}
									</span>
								);
							})}
						</pre>
					</div>

					{/* Reply draft */}
					<div className="border-t border-border px-3 py-2">
						<p className="mb-1 text-[9px] font-medium text-text-faint">REPLY DRAFT</p>
						<p className="text-[10px] text-text-secondary">{SOLVER_FIX.reply}</p>
					</div>
				</div>

				{/* Action bar */}
				<div className="mt-3 flex items-center gap-2">
					<button
						type="button"
						className="flex-1 rounded-md bg-green/15 px-3 py-1.5 text-[10px] font-medium text-green transition-colors hover:bg-green/25"
					>
						✓ Approve & Push
					</button>
					<button
						type="button"
						className="rounded-md bg-bg-elevated px-3 py-1.5 text-[10px] text-text-muted transition-colors hover:bg-bg-overlay"
					>
						Dismiss
					</button>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/website/src/components/mockup/review-panel.tsx apps/website/src/components/mockup/comment-solver-view.tsx
git commit -m "feat(website): add AI review panel and comment solver views"
```

---

## Task 8: Create feature cards and assemble the page

**Files:**
- Create: `src/components/feature-cards.tsx`
- Modify: `src/components/cta-footer.tsx`
- Modify: `src/components/section.tsx`
- Modify: `src/app/page.tsx`
- Delete: `src/components/app-mockup.tsx`, `src/components/feature-swarm.tsx`, `src/components/feature-review.tsx`, `src/components/feature-terminal.tsx`, `src/components/feature-integrations.tsx`
- Delete: `src/components/logos/` (entire directory)

- [ ] **Step 1: Create feature-cards.tsx**

Create `src/components/feature-cards.tsx`:

```tsx
import { Section } from "./section";

const CARDS = [
	{
		icon: "⚡",
		title: "PR Intelligence",
		description:
			"AI reviews your PRs, finds issues, and fixes them — automatically.",
	},
	{
		icon: "◉",
		title: "Agent Orchestration",
		description:
			"See every AI agent across all your workspaces at a glance.",
	},
	{
		icon: "⬡",
		title: "Everything Integrated",
		description:
			"Jira, Linear, GitHub, Bitbucket — all in one sidebar.",
	},
];

export function FeatureCards() {
	return (
		<Section label="Features">
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				{CARDS.map((card) => (
					<div
						key={card.title}
						className="rounded-xl border border-border bg-bg-surface p-5"
					>
						<span className="text-lg text-accent">{card.icon}</span>
						<h3 className="mt-2 text-sm font-semibold text-text-primary">
							{card.title}
						</h3>
						<p className="mt-1 text-xs leading-relaxed text-text-secondary">
							{card.description}
						</p>
					</div>
				))}
			</div>
		</Section>
	);
}
```

- [ ] **Step 2: Update cta-footer.tsx — change glow and accent references**

Replace the glow div in `src/components/cta-footer.tsx`:

Change `rgba(10,132,255,0.08)` to `var(--color-brand-glow)` in the radial gradient.

```tsx
import { SITE } from "@/lib/constants";
import { Section } from "./section";

export function CtaFooter() {
	return (
		<Section label="Download" className="text-center">
			{/* Brand glow */}
			<div className="pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[500px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse,var(--color-brand-glow)_0%,transparent_70%)]" />

			<h2 className="relative text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
				Ready to manage your swarm?
			</h2>

			<div className="relative mt-6 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-7">
				<a
					href={SITE.download}
					target="_blank"
					rel="noopener noreferrer"
					className="text-[17px] text-accent transition-opacity hover:opacity-80"
				>
					Download for Mac ›
				</a>
				<a
					href={SITE.github}
					target="_blank"
					rel="noopener noreferrer"
					className="text-[17px] text-accent transition-opacity hover:opacity-80"
				>
					Star on GitHub ›
				</a>
			</div>

			<p className="relative mt-2 text-[11px] text-text-faint">Free & open source · macOS</p>

			<footer className="relative mt-16 border-t border-border pt-6">
				<p className="text-xs text-text-faint">
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
```

- [ ] **Step 3: Update page.tsx — assemble the new page**

Replace the full content of `src/app/page.tsx`:

```tsx
import { CtaFooter } from "@/components/cta-footer";
import { FeatureCards } from "@/components/feature-cards";
import { Hero } from "@/components/hero";
import { MockupShell } from "@/components/mockup/mockup-shell";
import { Nav } from "@/components/nav";

export default function Home() {
	return (
		<>
			<Nav />
			<main>
				<Hero />
				<MockupShell />
				<FeatureCards />
				<CtaFooter />
			</main>
		</>
	);
}
```

- [ ] **Step 4: Delete old components**

```bash
rm apps/website/src/components/app-mockup.tsx
rm apps/website/src/components/feature-swarm.tsx
rm apps/website/src/components/feature-review.tsx
rm apps/website/src/components/feature-terminal.tsx
rm apps/website/src/components/feature-integrations.tsx
rm -rf apps/website/src/components/logos/
```

- [ ] **Step 5: Verify the full page renders**

```bash
cd apps/website && bun run dev
```

Expected: Page loads with animated logo hero → interactive mockup → feature cards → CTA footer. Clicking sidebar tabs switches views. Clicking PR #28 shows the detail + review panel. Clicking "Fix" shows the comment solver.

- [ ] **Step 6: Run type-check and lint**

```bash
cd apps/website && bun run type-check && bun run lint
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add -A apps/website/src/
git commit -m "feat(website): assemble interactive app mockup page with feature cards"
```

---

## Task 9: Build verification and final polish

**Files:**
- Verify: all files

- [ ] **Step 1: Run production build**

```bash
cd apps/website && bun run build
```

Expected: Static export succeeds, output in `out/` directory.

- [ ] **Step 2: Visual review in browser**

Open the dev server and verify:
- [ ] Animated logo breathes correctly in hero
- [ ] Brand glow visible behind logo
- [ ] Muted amber accent on all CTAs, labels, links
- [ ] Sidebar segment switching works (Repos → Tickets → PRs)
- [ ] PR #28 selection shows detail + review panel
- [ ] "Fix →" button transitions to comment solver view
- [ ] Terminal view shows realistic SuperiorSwarm dev output
- [ ] Ticket board shows static Kanban columns
- [ ] Mobile layout: stacked single column, horizontal tab bar
- [ ] `prefers-reduced-motion`: no animations, static logo
- [ ] Feature cards render in 3-column grid on desktop, single column on mobile
- [ ] CTA footer has brand glow
- [ ] No old blue (#0a84ff) visible anywhere

- [ ] **Step 3: Fix any issues found in visual review**

Address any visual issues, spacing problems, or color inconsistencies.

- [ ] **Step 4: Final commit**

```bash
git add -A apps/website/
git commit -m "chore(website): final polish and build verification"
```
