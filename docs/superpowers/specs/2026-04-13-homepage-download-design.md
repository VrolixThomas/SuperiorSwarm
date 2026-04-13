# Homepage Download Beta Release

## Summary

Replace the waitlist-first homepage with an OS-aware landing page. Mac and mobile users see a direct `.dmg` download button. Windows and Linux users see the waitlist form with their platform auto-detected. The existing hidden `/downloads` page redirects to the homepage.

## OS Detection

Client-side hook `useDetectedPlatform` parses `navigator.userAgent` and returns `"mac" | "windows" | "linux" | "mobile"`.

- SSR default: `"mac"` (avoids flash — download is the primary CTA)
- Hydration resolves to actual platform

Display logic:
- `"mac"` or `"mobile"` → download button
- `"windows"` or `"linux"` → waitlist form

## Hero Section (`hero.tsx`)

**Mac / mobile users:**
- Download button: "Download for macOS" with download icon (same style as current downloads page button)
- Subtle metadata line below: `v0.4.9 · Intel & Apple Silicon · 148 MB`
- GitHub star link remains below

**Windows / Linux users:**
- Existing waitlist form (email input + "Join waitlist" button)
- Subtitle changes to: "Signing up for {Windows|Linux} · macOS available now"
- GitHub star link remains below

The hero fetches release data server-side via `getLatestRelease()` (already exists in `lib/github.ts`) and passes it as props to the client component.

## Nav Bar (`nav.tsx`)

CTA button adapts:
- Mac / mobile: "Download" → links to `.dmg` URL
- Windows / Linux: "Join Waitlist" → scrolls to `#waitlist`

The page-level server component passes the dmg URL to a `ReleaseProvider` context so nav can access it without prop drilling through the layout.

## Waitlist Form (`waitlist-form.tsx`)

- Accepts a `platform` prop (`"windows" | "linux"`)
- Inserts `{ email, platform }` into Supabase
- Success message: "We'll let you know when the {Windows|Linux} build is ready."
- Duplicate message stays as-is
- Subtitle: "Signing up for {platform} · macOS available now"

## CTA Footer (`cta-footer.tsx`)

Same OS-detection logic as hero:
- Mac / mobile: download button + subtle version line
- Windows / Linux: waitlist form with auto-detected platform
- Heading stays: "Ready to manage your swarm?"

## Database Migration

New migration `00003_waitlist_platform.sql`:

```sql
ALTER TABLE public.waitlist ADD COLUMN platform text;
```

Nullable — existing rows unaffected. No enum constraint needed; values are `"windows"` or `"linux"`.

## Downloads Page Redirect

`app/downloads/page.tsx` replaced with a redirect to `/`:

```typescript
import { redirect } from "next/navigation";
export default function DownloadsPage() {
  redirect("/");
}
```

## Data Flow

```
page.tsx (server component)
  └─ getLatestRelease() → { tagName, dmgUrl, dmgSize, publishedAt }
  └─ wraps children in ReleaseProvider with release data

Hero (client component)
  └─ useDetectedPlatform() → platform
  └─ useRelease() → release data from context
  └─ platform is mac/mobile → DownloadButton
  └─ platform is windows/linux → WaitlistForm (with platform prop)

Nav (client component)
  └─ useDetectedPlatform() → platform
  └─ useRelease() → dmgUrl from context
  └─ mac/mobile → "Download" link; windows/linux → "Join Waitlist" anchor

CtaFooter (client component)
  └─ useDetectedPlatform() → platform
  └─ useRelease() → release data from context
  └─ same branching as Hero
```

## New Files

- `src/lib/use-detected-platform.ts` — shared hook
- `src/lib/release-context.tsx` — React context for release data
- `supabase/migrations/00003_waitlist_platform.sql` — migration

## Modified Files

- `src/app/page.tsx` — fetch release data, pass to components
- `src/components/hero.tsx` — conditional rendering based on platform
- `src/components/nav.tsx` — adaptive CTA button
- `src/components/waitlist-form.tsx` — accept platform prop, include in insert
- `src/components/cta-footer.tsx` — conditional rendering based on platform
- `src/components/cta-links.tsx` — can be removed (unused after this change)
- `src/app/downloads/page.tsx` — replace with redirect
