# Homepage Download Beta Release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the waitlist-first homepage with an OS-aware landing page where Mac/mobile users see a direct download button and Windows/Linux users see a platform-aware waitlist form.

**Architecture:** Client-side OS detection via `useDetectedPlatform` hook. Server-side release data fetched in `page.tsx` and distributed via React context (`ReleaseProvider`). Waitlist form extended with a `platform` column.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, Supabase, motion/react

---

### Task 1: Database migration — add platform column

**Files:**
- Create: `supabase/migrations/00003_waitlist_platform.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/00003_waitlist_platform.sql
ALTER TABLE public.waitlist ADD COLUMN platform text;
```

- [ ] **Step 2: Apply the migration**

Run the migration against your Supabase instance (via dashboard or CLI).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00003_waitlist_platform.sql
git commit -m "feat: add platform column to waitlist table"
```

---

### Task 2: Create `useDetectedPlatform` hook

**Files:**
- Create: `apps/website/src/lib/use-detected-platform.ts`

- [ ] **Step 1: Create the hook**

```typescript
"use client";

import { useEffect, useState } from "react";

export type DetectedPlatform = "mac" | "windows" | "linux" | "mobile";

function detectPlatform(): DetectedPlatform {
	const ua = navigator.userAgent;

	// Check mobile first — phones/tablets can't run the desktop app
	if (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
		return "mobile";
	}

	if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
	if (/Windows/i.test(ua)) return "windows";
	if (/Linux/i.test(ua)) return "linux";

	// Unknown → show download (primary CTA)
	return "mac";
}

export function useDetectedPlatform(): DetectedPlatform {
	// SSR default: "mac" to avoid flash — download is the primary CTA
	const [platform, setPlatform] = useState<DetectedPlatform>("mac");

	useEffect(() => {
		setPlatform(detectPlatform());
	}, []);

	return platform;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/lib/use-detected-platform.ts
git commit -m "feat: add useDetectedPlatform hook"
```

---

### Task 3: Create `ReleaseProvider` context

**Files:**
- Create: `apps/website/src/lib/release-context.tsx`
- Reference: `apps/website/src/lib/github.ts` (for `GitHubRelease` type)

- [ ] **Step 1: Create the context**

```tsx
"use client";

import type { GitHubRelease } from "@/lib/github";
import { createContext, use, type ReactNode } from "react";

const ReleaseContext = createContext<GitHubRelease | null>(null);

export function ReleaseProvider({
	release,
	children,
}: {
	release: GitHubRelease | null;
	children: ReactNode;
}) {
	return <ReleaseContext value={release}>{children}</ReleaseContext>;
}

export function useRelease(): GitHubRelease | null {
	return use(ReleaseContext);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/lib/release-context.tsx
git commit -m "feat: add ReleaseProvider context for release data"
```

---

### Task 4: Update `page.tsx` — fetch release data and wrap in provider

**Files:**
- Modify: `apps/website/src/app/page.tsx`

- [ ] **Step 1: Update page.tsx to fetch release data and wrap in ReleaseProvider**

Replace the entire file:

```tsx
import { AmbientParticles } from "@/components/ambient-particles";
import { CtaFooter } from "@/components/cta-footer";
import { FeatureSections } from "@/components/feature-sections";
import { Hero } from "@/components/hero";
import { MockupShell } from "@/components/mockup/mockup-shell";
import { Nav } from "@/components/nav";
import { ReleaseProvider } from "@/lib/release-context";
import { getLatestRelease } from "@/lib/github";

export default async function Home() {
	const release = await getLatestRelease();

	return (
		<ReleaseProvider release={release}>
			<AmbientParticles />
			<Nav />
			<main className="relative z-10">
				<Hero />
				<MockupShell />
				<FeatureSections />
				<CtaFooter />
			</main>
		</ReleaseProvider>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/app/page.tsx
git commit -m "feat: fetch release data in homepage server component"
```

---

### Task 5: Update `waitlist-form.tsx` — accept platform prop

**Files:**
- Modify: `apps/website/src/components/waitlist-form.tsx`

- [ ] **Step 1: Update the waitlist form to accept and send platform**

Replace the entire file:

```tsx
"use client";

import { supabase } from "@/lib/supabase";
import { useState } from "react";

type FormState = "idle" | "loading" | "success" | "error" | "duplicate";

export function WaitlistForm({ platform }: { platform: "windows" | "linux" }) {
	const [email, setEmail] = useState("");
	const [honeypot, setHoneypot] = useState("");
	const [state, setState] = useState<FormState>("idle");

	const platformLabel = platform === "windows" ? "Windows" : "Linux";

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!email.trim()) return;

		// Honeypot: bots auto-fill hidden fields, humans don't
		if (honeypot) {
			setState("success");
			return;
		}

		setState("loading");

		const { error } = await supabase
			.from("waitlist")
			.insert({ email: email.trim(), platform });

		if (error) {
			if (error.code === "23505") {
				setState("duplicate");
			} else {
				setState("error");
			}
			return;
		}

		setState("success");
		setEmail("");
	}

	if (state === "success") {
		return (
			<div className="flex flex-col items-center gap-2">
				<p className="text-[15px] font-medium text-accent">You're on the list.</p>
				<p className="text-[13px] text-text-secondary">
					We'll let you know when the {platformLabel} build is ready.
				</p>
			</div>
		);
	}

	if (state === "duplicate") {
		return (
			<div className="flex flex-col items-center gap-2">
				<p className="text-[15px] font-medium text-accent">You're already on the list.</p>
				<p className="text-[13px] text-text-secondary">We'll reach out when it's time.</p>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col items-center gap-3">
			{/* Honeypot — invisible to humans, bots auto-fill it */}
			<div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
				<label htmlFor="website">Website</label>
				<input
					id="website"
					name="website"
					type="text"
					tabIndex={-1}
					autoComplete="off"
					value={honeypot}
					onChange={(e) => setHoneypot(e.target.value)}
				/>
			</div>

			<div className="flex w-full max-w-sm flex-col items-stretch gap-2 sm:flex-row sm:items-center">
				<input
					type="email"
					required
					value={email}
					onChange={(e) => {
						setEmail(e.target.value);
						if (state === "error") setState("idle");
					}}
					placeholder="you@email.com"
					className="flex-1 rounded-full border border-border bg-bg-surface px-5 py-2.5 text-[15px] text-text-primary placeholder:text-text-faint outline-none transition-colors focus:border-accent"
				/>
				<button
					type="submit"
					disabled={state === "loading"}
					className="shrink-0 rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-bg-base transition-shadow hover:shadow-[0_0_20px_rgba(196,149,108,0.3)] disabled:opacity-50"
				>
					{state === "loading" ? "Joining..." : "Join waitlist"}
				</button>
			</div>
			{state === "error" && (
				<p className="text-[13px] text-red">Something went wrong. Try again.</p>
			)}
			<p className="text-[11px] text-text-faint">
				Signing up for {platformLabel} · macOS available now
			</p>
		</form>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/waitlist-form.tsx
git commit -m "feat: waitlist form accepts platform prop and sends to supabase"
```

---

### Task 6: Create `DownloadButton` component

This is a shared component used by both Hero and CTA Footer for Mac/mobile users.

**Files:**
- Create: `apps/website/src/components/download-button.tsx`
- Reference: `apps/website/src/lib/github.ts` (for `GitHubRelease` type)
- Reference: `apps/website/src/lib/constants.ts` (for `SITE.download` fallback)

- [ ] **Step 1: Create the download button component**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/download-button.tsx
git commit -m "feat: add shared DownloadButton component"
```

---

### Task 7: Update `hero.tsx` — conditional rendering by platform

**Files:**
- Modify: `apps/website/src/components/hero.tsx`

- [ ] **Step 1: Update hero to show download or waitlist based on platform**

Replace the entire file:

```tsx
"use client";

import { DownloadButton } from "@/components/download-button";
import { useRelease } from "@/lib/release-context";
import { useDetectedPlatform } from "@/lib/use-detected-platform";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedLogo } from "./animated-logo";
import { GitHubStarLink } from "./github-stars";
import { WaitlistForm } from "./waitlist-form";

export function Hero() {
	const reduced = useReducedMotion();
	const platform = useDetectedPlatform();
	const release = useRelease();
	const showDownload = platform === "mac" || platform === "mobile";

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
					<span
						className="text-accent"
						style={{ textShadow: "0 0 40px rgba(196,149,108,0.3)" }}
					>
						Superiorly.
					</span>
				</motion.h1>

				<motion.p
					initial={reduced ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3, delay: 0.25 }}
					className="mx-auto mt-5 max-w-[480px] text-base text-text-secondary md:text-[17px] md:leading-relaxed"
				>
					The desktop command center for AI coding agents. Run agents, review PRs
					automatically, and manage every branch — all from one window.
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
						<WaitlistForm platform={platform as "windows" | "linux"} />
					)}
					<GitHubStarLink />
				</motion.div>
			</div>
		</section>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/hero.tsx
git commit -m "feat: hero shows download or waitlist based on detected platform"
```

---

### Task 8: Update `nav.tsx` — adaptive CTA button

**Files:**
- Modify: `apps/website/src/components/nav.tsx`

- [ ] **Step 1: Update nav to show Download or Join Waitlist based on platform**

Replace the entire file:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/nav.tsx
git commit -m "feat: nav CTA adapts to detected platform"
```

---

### Task 9: Update `cta-footer.tsx` — conditional rendering by platform

**Files:**
- Modify: `apps/website/src/components/cta-footer.tsx`

- [ ] **Step 1: Update CTA footer to show download or waitlist based on platform**

Replace the entire file:

```tsx
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
						background:
							"linear-gradient(90deg, transparent, rgba(196,149,108,0.4), transparent)",
					}}
				/>
				<div
					className="mx-auto h-px max-w-2xl blur-[20px]"
					style={{
						background:
							"linear-gradient(90deg, transparent, rgba(196,149,108,0.3), transparent)",
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/cta-footer.tsx
git commit -m "feat: CTA footer adapts to detected platform"
```

---

### Task 10: Replace downloads page with redirect

**Files:**
- Modify: `apps/website/src/app/downloads/page.tsx`

- [ ] **Step 1: Replace with redirect**

Replace the entire file:

```tsx
import { redirect } from "next/navigation";

export default function DownloadsPage() {
	redirect("/");
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/app/downloads/page.tsx
git commit -m "feat: redirect /downloads to homepage"
```

---

### Task 11: Remove unused `cta-links.tsx`

**Files:**
- Delete: `apps/website/src/components/cta-links.tsx`

- [ ] **Step 1: Verify no imports remain**

Run: `grep -r "cta-links" apps/website/src/`
Expected: No results (the only consumer was the downloads page which now redirects).

- [ ] **Step 2: Delete the file**

```bash
rm apps/website/src/components/cta-links.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/website/src/components/cta-links.tsx
git commit -m "chore: remove unused cta-links component"
```

---

### Task 12: Verify — dev server and lint

- [ ] **Step 1: Run type check**

Run: `cd apps/website && bun run type-check`
Expected: No errors.

- [ ] **Step 2: Run lint/format**

Run (from repo root): `bun run check`
Expected: No errors. If formatting issues, run `bun run format` and commit.

- [ ] **Step 3: Run dev server and test in browser**

Run: `bun run dev`

Test these scenarios:
1. Open homepage on Mac — should see "Download for macOS" button with version/size metadata
2. Override user agent to Windows — should see waitlist form with "Signing up for Windows · macOS available now"
3. Override user agent to Linux — should see waitlist form with "Signing up for Linux · macOS available now"
4. Nav CTA should adapt: "Download" for Mac, "Join Waitlist" for Windows/Linux
5. CTA footer at bottom should match hero behavior
6. Visit `/downloads` — should redirect to `/`
7. Submit waitlist on Windows UA — check Supabase table has `platform: "windows"`

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
