---
name: trailer-production
description: Use when building, editing, reviewing, or rendering the SuperiorSwarm Remotion hero trailer in apps/trailer/ (HeroBuildV2/V3/V4, hero-build-v*.mp4) — including scene work, voice-over/audio, app-mirror views, continuity fixes, or any "the trailer looks wrong" iteration. Encodes hard-won rules from prior sessions where Claude fabricated UI, leaked private data, broke continuity, or shipped without reviewing the render.
trigger: /trailer-production
---

# trailer-production

Marketing hero trailer (Remotion) for the SuperiorSwarm Electron app. Composition lives in `apps/trailer/`; outputs to `launchcontent/videos/hero-build-v{2,3,4}.mp4`. Versions are **additive** — never overwrite a prior version.

The trailer is a **1:1 mirror of the real app**, narrated by VO and scored with music. Every visible UI element must trace to a real component in `apps/desktop/src/renderer/components/`. Every name/repo/PR/ticket/file shown must be **fictional mock data**, never copied from the user's actual workspace or shared screenshots.

## The Iron Rules

These were stated by the user in caps, repeatedly, across sessions. Treat as hard fails.

1. **"NEVER SELF FABRICATE COMPONENTS FOR THE VIDEO, ALWAYS USE OUR CODE AND MAKE SURE IT IS A ONE TO ONE MAP."** — Before drawing any panel, sidebar, tab, badge, button, or layout: open the real component in `apps/desktop/src/renderer/components/<area>/` and mirror its markup + classnames. Strip tRPC/stores/Monaco; keep visual structure exact.
2. **"NEVER BUT NEVER NEVER NEVER MAKE THINGS UP, ALL CONTENT NEEDS TO BE REAL FROM OUR APP."** — No invented buttons, no decorative logos, no fake repos, no "approximate" layouts. If unsure what the real shape is, read the source. The source is ground truth, not screenshots, not memory.
3. **Reference screenshots ≠ content source.** When the user shares an app screenshot for layout reference, use it for *layout/structure only*. All text content (repo names, file names, code, PR titles, reviewer names, ticket IDs, branch names, teammate names) must be generic fictional mock data. Their real workspace is private.
4. **Brand name `SuperiorSwarm` stays.** Branch names like `MarketingImages` do not — use fictional branch names in mocks.
5. **Plan before code on multi-point feedback.** When the user lists ≥2 issues or asks for a review, produce a written plan and wait for approval. Do NOT jump to edits. They have said "FIRST MAKE A PLAN" with profanity. Trigger phrase: any review/critique with multiple findings.
6. **Versions are additive.** Never overwrite `hero-build-v2.mp4` to build v3, etc. New version = new `HeroBuildV<N>` composition, new id in `Root.tsx`, new entry in `scripts/render.ts` `TARGETS`, new output filename.

## Mock Data Conventions

Mock data lives in `apps/trailer/src/hero/build-v4/data.ts` (and v2/v3 equivalents). Curate around generic agentic / dev-workflow themes:

| Field | DO use | DON'T use |
|---|---|---|
| Repo names | `agentic-runtime`, `mcp-bridge`, `swarm-orchestrator` | Real user repos from screenshots |
| Branch names | `feat/parallel-agents`, `fix/socket-leak` | `MarketingImages` or any real branch |
| Reviewer names | Generic first names | Real teammate names (marko/elena/etc.) |
| PR/ticket titles | Generic agentic-workflow titles | Anything verbatim from user screenshots |
| File contents | Generic TS/Python | Real code from user's repos |

## Visual / Animation Rules (Learned The Hard Way)

| Rule | Why |
|---|---|
| No CSS `filter: blur(...)` as transition | User explicitly rejected — "video has also become blurry" |
| Only intended elements animate | User: "the pulse in the logo is fine but the text everywhere is also going up and down which we dont want" |
| Theme/light-mode sweep: steep diagonal, NOT 45°, takes significant vertical space at once | Explicit geometry spec; don't substitute a "nicer" angle |
| Light → dark return: **retract** the light mode (reverse the sweep), don't run a new transition | User: "the transition back is weird" |
| Cross-act transitions = **morph**, never hard cut | "when the terminals merge they merge in the starting point of our build not some random terminal that then gets framecut" |
| Preserve state between scenes; update in place | "we should have kept the previous state adn just update it with the active icons instead of rebulding" |
| Code panes: real syntax highlighting | "should have syntax highlighting, not just plain white text" |
| Pacing is **natural per beat**, not padded to a target | "we dont need to exact 90s to have 90s — feel natural and dedicate proper time for each case"; also avoid "everything feels rushed" |
| Show real chrome (sidebar, tab strip, right panel) | "looks like you are missing the right side panel?" / "no dif visible" |
| Pane content coherence — file open ↔ terminal narration ↔ diff ↔ PR title all describe the same fictional task | "you have AgentTerminal.tsx highlighted but are showing hello world file that opens" |

## Workflow

### Building or editing a scene

1. Identify which real component you're mirroring. Path it in `apps/desktop/src/renderer/components/<area>/`. Read it.
2. Look at existing `views/With*.tsx` in `apps/trailer/src/hero/build-v4/views/` for the established mirror pattern.
3. Use color tokens from `colors-v4.tsx`. Use mock data from `data.ts`. Use timeline constants from `timeline.ts`.
4. If introducing a NEW view: add to `WorkspaceViewSelector.ts` (frame → view key map) so it routes from the composition.

### Responding to a critique with multiple findings

**Do not edit yet.** Produce a numbered plan:
- Each finding → 1 plan item with the file(s) involved and the proposed change.
- For visual issues, quote the user's exact words so they know you read them.
- Wait for approval before touching code.

After implementation, **verify each item** individually by re-rendering + viewing. Don't claim all-fixed until you confirm each one. User has said: "Some of the other things are also still not fixed correctly" — partial fixes that get claimed as done are the most damaging failure.

### Rendering

```bash
cd apps/trailer
bun run render v4              # one target
bun run render all             # v2 + v3 + v4
```

Output: `launchcontent/videos/hero-build-v<N>.mp4`. **Always tell the user the output path** when done — user has asked "where is the output?" because Claude finished silently.

For audio regeneration: `bun scripts/generate-audio-v4.ts` (writes to `public/audio/v4/` and regenerates `audioManifest.gen.ts`).

### Before declaring done

- Confirm you rendered against the latest source (no stale build).
- For VO/sync work: walk the timeline against `beat-copy.ts` + `audioManifest.gen.ts` — verify the file shown, terminal narration, and VO line all describe the same beat.
- Surface the render command + output path.
- Note any new compositions registered in `Root.tsx`.

## Cleanup Scope Discipline

When asked to "clean up" or "remove old trailer work":

- Only touch files **added or modified in the current branch**. Use `git log main..HEAD --name-only` to scope.
- **Never touch `apps/website/`, `apps/desktop/`, `apps/screenshots/`** unless the change explicitly came from this branch.
- Before deleting any file: grep for references across the repo, AND if the user pushes back ("isnt this used for hero-build-v2?"), re-verify — do not "trust the grep" and ignore the concern.
- After any cleanup, **re-render** to verify nothing broke. The user has had to prompt this manually.

## DON'T list (quick scan)

- Don't fabricate UI elements, even "just for this one frame".
- Don't copy text content from user-shared screenshots into mock data.
- Don't overwrite previous trailer versions.
- Don't add CSS blur as a transition effect.
- Don't apply text-wide motion (only intended elements animate).
- Don't pad or truncate duration to hit a round number (e.g. 90s).
- Don't hard-cut between acts when continuity was the spec.
- Don't start editing on a multi-point critique — plan first.
- Don't claim multi-issue feedback is "all fixed" without verifying each one.
- Don't render and walk away — surface output path and confirm sync.
- Don't delete files outside the branch's modification set.
- Don't substitute a "more elegant" angle/timing/order when the user specified one.
- Don't run `dev` and `render` from the repo root — they're in `apps/trailer/`.
- Don't add `Co-Authored-By` trailers to commits (project rule).
- Don't use npm/yarn — Bun only.

## DO list (quick scan)

- Read the real desktop component before mirroring it.
- Use generic agentic-themed mock data; keep brand name SuperiorSwarm.
- Make plans for multi-issue feedback before any edit.
- Verify each fix individually after implementation.
- Re-render and surface the output path before declaring done.
- Keep state between scenes; animate transitions in place.
- Use syntax-highlighted code panes (see `syntax.ts`).
- Register new versions additively (new composition id, new TARGETS entry).
- When in doubt about layout/component shape, read the source — it's authoritative.

## Files index

| Need | Path |
|---|---|
| Composition root | `apps/trailer/src/Root.tsx` |
| Render targets | `apps/trailer/scripts/render.ts` (`TARGETS`) |
| v4 composition | `apps/trailer/src/compositions/HeroBuildV4.tsx` |
| v4 views (app mirrors) | `apps/trailer/src/hero/build-v4/views/` |
| v4 scenes (overlays) | `apps/trailer/src/hero/build-v4/scenes/` |
| v4 mock data | `apps/trailer/src/hero/build-v4/data.ts` |
| v4 colors | `apps/trailer/src/hero/build-v4/colors-v4.tsx` |
| v4 timeline | `apps/trailer/src/hero/build-v4/timeline.ts` |
| v4 VO copy | `apps/trailer/src/hero/build-v4/beat-copy.ts` |
| v4 audio manifest (generated) | `apps/trailer/src/hero/build-v4/audioManifest.gen.ts` |
| Audio gen script | `apps/trailer/scripts/generate-audio-v4.ts` |
| Audio assets | `apps/trailer/public/audio/v4/` |
| Source-of-truth components | `apps/desktop/src/renderer/components/` |
