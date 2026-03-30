# SuperiorSwarm Website Update — Design Spec

## Overview

Update the existing single-page marketing website from a static brochure into an **interactive app replica** that lets visitors explore how SuperiorSwarm actually looks and works. The mockup uses SuperiorSwarm building itself as the demo data — dogfooding the product.

**Goal:** Give visitors a real feel for the app before downloading. Drive macOS downloads and GitHub stars.

**Key constraint:** No real state management. Every view is a static mockup that looks interactive — clickable tabs switch views, but nothing tracks state beyond which view is currently shown.

## Branding Update

### Logo
- **Icon:** Animated particle swarm from `/superiorswarm/svg/icon-animated.svg` (hero)
- **Static fallback:** `/superiorswarm/svg/icon-static.svg` (for `prefers-reduced-motion` and nav)
- **Favicons:** From `/superiorswarm/web/` (favicon.ico, favicon-16.png, favicon-32.png, favicon-48.png, apple-touch-icon.png)
- **OG image:** `/superiorswarm/web/og-image-1200x630.png`
- **PWA icons:** `/superiorswarm/web/icon-192.png`, `/superiorswarm/web/icon-512.png`

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent` | `#c4956c` (muted amber) | Links, CTAs, section labels, interactive highlights |
| `--color-accent-dim` | `rgba(196, 149, 108, 0.12)` | Hover states, subtle backgrounds |
| `--color-brand` | `#e07030` | Logo mark only — nowhere else |
| `--color-brand-glow` | `rgba(224, 112, 48, 0.15)` | Radial glow behind animated logo in hero |
| `--color-bg-base` | `#050507` | Page background (unchanged) |
| `--color-bg-surface` | `#0d0d10` | Card/panel backgrounds (unchanged) |
| `--color-bg-elevated` | `#111114` | Mockup panel backgrounds (unchanged) |
| `--color-bg-overlay` | `#1a1a1e` | Mockup header bars (unchanged) |
| `--color-text` | `#f5f5f7` | Primary text (unchanged) |
| `--color-text-secondary` | `#a1a1a6` | Body text (unchanged) |
| `--color-text-muted` | `#636366` | Muted text (unchanged) |
| `--color-text-faint` | `#48484a` | Metadata (unchanged) |
| `--color-border` | `rgba(255, 255, 255, 0.08)` | Borders (unchanged) |
| `--color-green` | `#28c840` | Success/running status (unchanged) |
| `--color-yellow` | `#febc2e` | Warning indicators (unchanged) |
| `--color-red` | `#ff5f57` | Error/danger (unchanged) |
| `--color-purple` | `#c084fc` | Agent status accent (unchanged) |

### Typography
- **Primary:** Inter (unchanged)
- **Monospace:** Geist Mono (unchanged)

## Page Structure

### 1. Navigation (sticky)

- **Left:** Particle swarm logo (static SVG, ~24px) + "SuperiorSwarm" wordmark
- **Right:** "GitHub" (external link) · "Download for Mac" (text link)
- **Style:** Transparent background, backdrop-blur on scroll. Muted amber for links. No buttons.
- **Mobile:** Logo + "Download" only. GitHub accessible via CTA footer.

### 2. Hero Section

**Animated logo:**
- Centered animated particle swarm SVG (~140px)
- 3.2s breathing animation cycle (from `icon-animated.svg`)
- Subtle radial glow behind it using `--color-brand-glow`
- Falls back to `icon-static.svg` on `prefers-reduced-motion`

**Headline:**
- "Manage your swarm." (line 1, white)
- "Superiorly." (line 2, muted amber `#c4956c`)
- ~56px, weight 700, tight tracking

**Subtitle:**
- "The desktop command center for AI coding agents. Run agents, review PRs automatically, and manage every branch — all from one window."
- 17px, `--color-text-secondary`, max-width 480px centered

**CTAs:**
- "Download for Mac ›" → GitHub Releases latest .dmg
- "Star on GitHub ›" → repo URL
- Both in muted amber, side by side
- Below: "Free & open source · macOS" in `--color-text-faint`

**No app screenshot in hero** — the interactive mockup directly below serves as the hero visual.

### 3. Interactive App Mockup (the main event)

Full-width (~1060px max) interactive replica of the SuperiorSwarm desktop app with macOS window chrome (traffic light dots).

#### Three-Panel Layout (Desktop)

**Left Sidebar (~240px)**

Segmented control at top: **Repos** | **Tickets** | **PRs**

Clicking each segment switches the sidebar content AND the center/right panel content.

**Repos segment (default view):**
- Project list: "SuperiorSwarm" (selected, green dot), "relay-api" (gray), "docs" (gray)
- Below project list: "Active Agents" section showing:
  - Claude Code — `feature/ticket-board` — "Implementing drag-and-drop" (green pulse)
  - PR Review Agent — `PR #28` — "Reviewing changes" (blue pulse)
  - Codex — `fix/oauth-refresh` — "Fixing token expiry" (purple pulse)
- Center panel: Terminal view
- Right panel: collapsed/hidden

**Tickets segment:**
- Static Jira board visual with columns: TODO (2 cards), IN PROGRESS (2 cards), IN REVIEW (1 card), DONE (3 cards)
- Cards show ticket keys (SS-41, SS-38, etc.) and short titles related to SuperiorSwarm features
- No dragging — purely visual
- Center panel: ticket board takes full width (no center/right split)
- Right panel: hidden

**PRs segment:**
- PR list with status badges:
  - PR #28 "Make PR section similar to repo workspaces" — green CI, APPROVED badge, 2 reviewer avatars
  - PR #27 "Add drag-and-drop ticket board" — yellow CI (pending), no review yet
  - PR #25 "Fix OAuth token refresh race condition" — green CI, CHANGES_REQUESTED badge
- Clicking PR #28 shows:
  - Center panel: PR overview with file list and diff preview
  - Right panel: AI Review findings panel

**Center Panel (~480px)**

Content depends on active sidebar segment:

- **Repos/default:** Terminal mockup
  - Tab bar: `zsh` (active), `bun dev`
  - Terminal content showing:
    ```
    ~/SuperiorSwarm (feature/ticket-board) $ bun run dev
    $ turbo run dev
    • Packages in scope: superiorswarm
    ✓ electron-vite dev server running
      ➜ Local: http://localhost:5173/
      ➜ Electron: ready in 1.2s
    [HMR] connected
    ```
  - Green prompt, branch name in prompt, realistic Vite/Turbo output

- **Tickets:** Ticket board fills the full center+right area (no right panel)

- **PRs (PR #28 selected):** PR detail view
  - Header: PR title, author, branch `feature/pr-section → main`
  - File list: `src/renderer/components/PullRequestsTab.tsx` (+142, -38), `src/renderer/components/PRCard.tsx` (+67, -12), etc.
  - Diff preview showing a snippet of the PullRequestsTab changes

**Right Panel (~340px)**

Only visible when relevant content exists:

- **Repos/default:** Hidden (terminal takes full center width)
- **Tickets:** Hidden (board takes full width)
- **PRs (PR #28 selected):** AI Review panel showing:
  - Header: "AI Review — PR #28" with status badge "Ready"
  - Review findings:
    - ⚠ Warning: "Missing error boundary around `PRCard` render — unhandled promise rejection in `fetchPRDetails` could crash the component tree" (file: PullRequestsTab.tsx, line 84)
    - ✓ Approved: "Good component decomposition — `PRCard` extracted cleanly with proper prop typing"
    - ℹ Suggestion: "Consider adding a loading skeleton while PR enrichment data is being fetched"
  - Below the warning: **"Fix →"** button in muted amber
  - Clicking "Fix" transitions the right panel to the **Comment Solver view**:
    - Header: "Comment Solver — PR #28"
    - Shows grouped fix: "Add ErrorBoundary wrapper around PRCard list"
    - Diff snippet: the fix (adding `<ErrorBoundary>` wrapper)
    - Status: "Fix ready" with "Approve & Push" button
    - Below: reply draft — "Added an error boundary around the PR card list to catch potential fetch failures. LGTM otherwise."

#### Mobile Layout

Single-column stacked layout. No 3-panel view.

- **Horizontal tab bar** at top of mockup: Repos | Tickets | PRs
- Each view renders as a full-width card:
  - Repos: project list + agents list (stacked vertically)
  - Terminal: full-width terminal mockup
  - Tickets: board scrolls horizontally
  - PRs: PR list, tap to expand inline PR detail + review panel
  - Comment solver: inline expansion below the review finding
- The mockup window chrome adapts: no traffic lights, rounded corners, subtle border

### 4. Feature Highlight Cards

Three concise cards in a horizontal row below the mockup. Each has an icon and a one-liner — they reinforce what was just seen above.

| Icon | Title | Description |
|------|-------|-------------|
| Review icon | **PR Intelligence** | AI reviews your PRs, finds issues, and fixes them — automatically. |
| Swarm icon | **Agent Orchestration** | See every AI agent across all your workspaces at a glance. |
| Plug icon | **Everything Integrated** | Jira, Linear, GitHub, Bitbucket — all in one sidebar. |

Style: `--color-bg-surface` background, `--color-border` border, muted amber icon tint. Small — max ~200px wide each.

### 5. CTA Footer

- Headline: "Ready to manage your swarm?"
- CTAs: "Download for Mac ›" and "Star on GitHub ›" in muted amber
- Below: "Free & open source · macOS"
- Footer: "Built by Thomas Vrolix"
- Subtle radial glow using `--color-brand-glow` behind the text

## Motion Design

- **Hero animated logo:** 3.2s breathing cycle, CSS animation (from SVG)
- **Hero text:** Fade-in stagger on page load (200ms, 300ms, 400ms delays)
- **Mockup tab switches:** Fade transition (~150ms) when switching sidebar segments or clicking a PR
- **Comment solver transition:** Slide-in from right (~200ms) when "Fix" is clicked
- **Feature cards:** Slide-up on scroll intersection (500ms, ease-out)
- **CTA footer:** Fade-in on scroll
- **prefers-reduced-motion:** All animations disabled, content shows immediately, animated logo replaced with static

## Responsive Breakpoints

- **Desktop (>1024px):** Full 3-panel mockup layout as described
- **Tablet (768-1024px):** Mockup scales down, right panel collapses into an expandable drawer below center panel
- **Mobile (<768px):** Single-column stacked layout with horizontal tab bar. Each panel is a section. PR review and comment solver expand inline.

## Accessibility

- Semantic HTML: `<nav>`, `<main>`, `<section>`, `<figure>`
- All interactive mockup elements use `role="button"` with `tabindex="0"` and keyboard handlers
- `aria-label` on the mockup container: "Interactive preview of SuperiorSwarm desktop app"
- `aria-live="polite"` on panel content areas so screen readers announce view changes
- Focus rings using 2px `--color-accent` outline
- Color contrast: muted amber `#c4956c` on `#050507` = 5.8:1 (passes WCAG AA)

## Assets Required

1. Copy `/superiorswarm/svg/icon-animated.svg` and `icon-static.svg` into website public/assets
2. Copy `/superiorswarm/web/*` into website public/ (favicons, OG image, PWA icons)
3. Remove old logo component (`logo.tsx`)
4. Integration logos (Jira, Linear, GitHub, Bitbucket) — keep existing SVG icons from `feature-integrations.tsx`

## Tech Stack

Unchanged:
- Next.js 15, React 19, Tailwind CSS v4, Motion (Framer Motion), Geist font, static export
- No new dependencies needed — the mockup is pure React + CSS

## What's NOT in Scope

- Supabase auth / login screen
- Real state management / persistence
- Ticket dragging
- Multiple pages / routing
- Documentation site
- Animated particle background effects beyond the logo
