# Contrast Improvements + Light Mode

**Date:** 2026-04-25
**Scope:** `apps/desktop/` only (website untouched)
**Goal:** Fix poor contrast in dark theme and add light mode with theme switching.

---

## Problem

The desktop app currently ships dark-only. On lower-quality displays content is hard to read. Investigation surfaced three root causes:

1. **Undefined CSS variables in use.** Components reference `--success`, `--danger`, `--warning`, `--success-subtle`, `--danger-subtle`, `--warning-subtle`, `--bg-active`, and `--border-default` — none are declared in `apps/desktop/src/renderer/styles.css`. They render as inherited or empty, producing washed-out badges, invisible borders, and missing hover states.
2. **Subthreshold contrast.** `--text-quaternary: #48484a` on `--bg-base: #0a0a0a` ≈ 3.4:1 (fails WCAG AA for normal text). Borders use `rgba(255,255,255,0.06)` ≈ 1.07:1 — invisible on poor panels. Background elevation steps (`#0a → #14 → #1c → #2c`) are too tight for visual hierarchy.
3. **No light mode.** Single `:root` block hard-codes dark values. Users on bright environments have no fallback.

## Goals

- Fix undefined-var bugs.
- Bump token contrast to meet WCAG AA for text/icons (4.5:1 normal, 3:1 large/UI).
- Add light theme with warm off-white aesthetic (`#fafaf7` base).
- User-toggleable theme (Light / Dark / System), persisted in DB, synced across windows.
- No flash on first paint.
- xterm and Monaco editor follow theme reactively.

## Non-Goals

- Touching `apps/website/`.
- Replacing all 159 hex literals (only sweep ones that break in light mode).
- AAA contrast targets.
- Visual regression test infra.
- High-contrast / sepia / additional themes (token system leaves room, but not built).
- Auditing every component for AA — only ones changed in this work.

---

## Architecture

### Theme switching mechanism: `data-theme` on `<html>`

```css
:root { /* dark values — also serve as first-paint fallback */ }
html[data-theme="light"] { --bg-base: #fafaf7; ... }
```

- Dark lives on `:root` (default + first-paint fallback). Light overrides via `[data-theme="light"]`.
- Theme switch = `document.documentElement.dataset.theme = "light" | "dark"`. Setting to `"dark"` removes any light overrides; `:root` values apply.
- One CSS file, identical token names across themes.
- All 123 existing `var(--*)` consumers work unchanged.
- xterm `Terminal.tsx:106` already watches `data-theme` via `MutationObserver` — no change needed.
- Monaco swaps via `monaco.editor.setTheme()` listener.

### Source of truth: SQLite via Drizzle

New table `app_settings` (key/value), seeded with `theme = 'system'` on first run.

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Migration name: `add_app_settings_table` (per CLAUDE.md naming rule).

### tRPC router: `src/main/trpc/settings.ts`

- `settings.getTheme(): 'system' | 'light' | 'dark'`
- `settings.setTheme(value)` — writes DB, broadcasts to all `BrowserWindow`s so multi-window stays in sync.

### Renderer store: `stores/theme-store.ts`

Zustand store matching existing project pattern.

```ts
type ThemePref = 'system' | 'light' | 'dark';
type Resolved  = 'light' | 'dark';

interface ThemeStore {
  pref: ThemePref;
  resolved: Resolved;             // applied theme after system resolution
  setPref(p: ThemePref): void;    // tRPC call + apply
}
```

### Apply mechanism: `lib/theme.ts`

1. Boot: read `pref` from DB. Resolve via `matchMedia('(prefers-color-scheme: dark)')` if `system`. Set `document.documentElement.dataset.theme`.
2. `matchMedia` change listener: re-resolve only when `pref === 'system'`.
3. tRPC broadcast listener: sync stores across windows.

### First-paint flash prevention

Inline `<script>` in `apps/desktop/src/renderer/index.html` reads `localStorage.theme` and sets `data-theme` before React mounts. DB is source of truth; localStorage is paint cache, written on every change.

---

## Token System

All tokens declared inside both `html[data-theme="dark"]` and `html[data-theme="light"]` blocks in `apps/desktop/src/renderer/styles.css`. Names identical across themes.

### Backgrounds (4 elevation levels + active)

| Token | Dark | Light | Notes |
|---|---|---|---|
| `--bg-base` | `#0a0a0a` | `#fafaf7` | App canvas |
| `--bg-surface` | `#161618` | `#f2f2ef` | Sidebar, panels (was `#141414` — bumped) |
| `--bg-elevated` | `#1f1f22` | `#ffffff` | Inputs, dropdowns (was `#1c1c1e` — bumped) |
| `--bg-overlay` | `#2c2c2e` | `#e8e8e3` | Hover, active |
| `--bg-active` *(new)* | `#3a3a3d` | `#dcdcd6` | Pressed/selected — fixes undefined ref |

### Borders

| Token | Dark | Light |
|---|---|---|
| `--border` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.10)` (was `0.06` — invisible) |
| `--border-subtle` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` |
| `--border-active` | `rgba(255,255,255,0.16)` | `rgba(0,0,0,0.18)` |
| `--border-default` *(new alias)* | = `--border` | fixes undefined ref |

### Text (4 levels, AA-verified)

| Token | Dark on `--bg-base` | Light on `--bg-base` | Min ratio |
|---|---|---|---|
| `--text` | `#f5f5f7` (18.9:1) | `#1d1d1f` (15.8:1) | AAA |
| `--text-secondary` | `#b5b5ba` (10.8:1) | `#3a3a3c` (10.7:1) | AAA |
| `--text-tertiary` | `#8e8e93` (6.7:1) | `#6e6e73` (5.0:1) | AA |
| `--text-quaternary` | `#6e6e73` (5.0:1) | `#8e8e93` (3.4:1) | AA-large |

Dark `--text-secondary` lifted from `#a1a1a6` → `#b5b5ba`. Dark `--text-tertiary` lifted from `#6e6e73` → `#8e8e93`. Dark `--text-quaternary` lifted from `#48484a` → `#6e6e73` (was failing AA).

### Semantic colors (with subtle backgrounds)

Both naming styles aliased so existing code resolves.

| Token | Dark | Light |
|---|---|---|
| `--color-danger` / `--danger` | `#ff453a` | `#d70015` |
| `--color-success` / `--success` | `#30d158` | `#1f883d` |
| `--color-warning` / `--warning` | `#ff9f0a` | `#bf6900` |
| `--color-purple` | `#bf5af2` | `#8944ab` |
| `--danger-subtle` *(new)* | `rgba(255,69,58,0.15)` | `rgba(215,0,21,0.10)` |
| `--success-subtle` *(new)* | `rgba(48,209,88,0.15)` | `rgba(31,136,61,0.10)` |
| `--warning-subtle` *(new)* | `rgba(255,159,10,0.15)` | `rgba(191,105,0,0.10)` |

### Accent

| Token | Dark | Light |
|---|---|---|
| `--accent` | `#0a84ff` | `#0066cc` (AA on white) |
| `--accent-hover` | `#409cff` (brighter) | `#004fa3` (darker) |
| `--accent-subtle` *(new)* | `rgba(10,132,255,0.12)` | `rgba(0,102,204,0.10)` |
| `--accent-foreground` *(new)* | `#ffffff` | `#ffffff` |

### Misc

| Token | Dark | Light |
|---|---|---|
| `--scrim` *(new, modal backdrops)* | `rgba(0,0,0,0.50)` | `rgba(0,0,0,0.35)` |
| `--bg-tab-bar` | `#111113` | `#ededea` |
| `--tab-active-bg` | `#1f1f22` | `#ffffff` |
| `--tab-inactive-bg` | `transparent` | `transparent` |
| `--tab-border` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.10)` |

Shadows kept dark-tuned for both themes (Apple-style elevation works on both).
Radii, motion, fonts, terminal ANSI palette: unchanged across themes (terminal needs vibrant saturation).

---

## UI: Theme Switching

### Settings page

Existing Settings (bottom-left of app shell). New "Appearance" section:

```
Appearance
─────────
Theme    ( ) Light  ( ) Dark  (•) System
```

Radio group, three options. Live preview (no apply button).

### Command palette

`components/CommandPalette.tsx` registers three commands:

- `Theme: Switch to Light`
- `Theme: Switch to Dark`
- `Theme: Use System`

All call `themeStore.setPref()`. Searchable as "theme", "light", "dark".

---

## Component Cleanup (Targeted)

### Pass A — fix undefined CSS vars

Add the new tokens above (`--success`, `--danger`, `--warning`, `--*-subtle`, `--bg-active`, `--border-default`). No component changes — refs resolve.

### Pass B — sweep hex literals that break in light mode

Run `rg -nE "#[0-9a-fA-F]{3,8}|bg-(black|white)|text-(black|white)" apps/desktop/src/renderer/components/`. Triage each:

| Pattern | Replace |
|---|---|
| `bg-black/40`, `bg-black/50`, `bg-black/60` (modal scrims) | `bg-[var(--scrim)]` |
| `text-white` on `bg-[var(--accent)]` | `text-[var(--accent-foreground)]` |
| `rgba(255,255,255,0.x)` borders/hovers | `var(--border)` / `var(--bg-overlay)` |
| `rgba(10,132,255,0.x)` accent tints | `var(--accent-subtle)` |
| Decorations in `styles.css` (`#fbbf24`, `#a78bfa`, `#4ade80`) | `var(--warning)`, `var(--color-purple)`, `var(--success)` |

### Pass C — Monaco editor theme

`apps/desktop/src/renderer/lib/monacoTheme.ts` registers both:

- `superiorswarm-dark` (existing) — base `vs-dark`, bg `#161618`
- `superiorswarm-light` (new) — base `vs`, bg `#ffffff`, diff colors retuned for light

Swap via `monaco.editor.setTheme()` on `data-theme` change. Affects `DiffEditor.tsx`, `FileEditor.tsx`, `ThreeWayDiffEditor.tsx`.

### Out of scope

- Vibrant decorative colors (AI badge violet, status dots) — leave; they read on both themes.
- Auditing components untouched by Passes A–C.

---

## Files Touched

**New:**
- `apps/desktop/src/main/trpc/settings.ts`
- `apps/desktop/src/main/db/migrations/<timestamp>_add_app_settings_table.sql`
- `apps/desktop/src/renderer/stores/theme-store.ts`
- `apps/desktop/src/renderer/lib/theme.ts`

**Modified:**
- `apps/desktop/src/renderer/styles.css` — split into `[data-theme="dark"]` / `[data-theme="light"]` blocks, add new tokens, retune contrast
- `apps/desktop/src/renderer/index.html` — first-paint script
- `apps/desktop/src/renderer/main.tsx` — boot theme apply
- `apps/desktop/src/renderer/lib/monacoTheme.ts` — register light theme, swap on change
- `apps/desktop/src/renderer/components/Settings*.tsx` — Appearance section
- `apps/desktop/src/renderer/components/CommandPalette.tsx` — theme commands
- `apps/desktop/src/main/db/schema.ts` — `app_settings` table
- `apps/desktop/src/main/trpc/index.ts` (or wherever routers compose) — register `settings` router
- Components touched by Pass B sweep (case-by-case)

---

## Verification

### Manual contrast check

Eyeball both themes on these surfaces with Chrome DevTools → Accessibility → Contrast ratio:

1. Sidebar branch list (the screenshot)
2. Terminal tab strip
3. PR list / Tickets list
4. Diff editor (Monaco)
5. Modal scrims (Settings, Command Palette)
6. Markdown body in AI review panels
7. Status badges (Resolved / Approved / Failed)
8. Resize handles + scrollbars

Fail = AA miss → bump token, re-check.

### Automated

- `bun run type-check` clean
- `bun run lint` clean
- `bun test` — existing tests pass (no theme tests added)

### Functional smoke

`bun run dev`:

- Toggle theme via Settings → applies live, no reload.
- Toggle each command-palette entry → applies.
- OS dark/light switch with `pref = 'system'` → follows.
- Reload → no flash, comes up in saved theme.
- xterm and Monaco swap colors live.
- Two windows open → setting in one syncs to the other.

### Rollout

Single PR. Default `pref = 'system'` for new installs. Existing users (no DB row) resolve to system → likely dark.

---

## Risks

- **Pass A unintentionally changes existing dark visuals** (because previously-broken `--success` etc. now actually render) → diff each Pass-A token surface before/after on dark, eyeball before merging.
- **Bumped `--text-tertiary` / `--text-secondary` may feel "louder"** than current muted aesthetic → acceptable trade for AA; if pushback, retune one notch down but stay above 4.5:1.
- **Pass B is a sweep**, not a hard list → estimate scope by ripgrep hit count before starting; if >40 distinct sites, narrow to scrims + accent-foreground only.
