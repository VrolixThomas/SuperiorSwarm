# Skip Permissions Toggle for AI Review Agents

## Problem

AI review agents (Claude, Gemini, Codex, OpenCode) launch without permission-skipping flags, so each tool call requires manual approval. For automated code review this is undesirable — the agents should run autonomously by default.

## Solution

A single "Auto-accept tool calls" toggle in Settings, defaulting to on (intentional for automated review workflows — user can disable in Settings). When enabled, the orchestrator prepends the appropriate permission-skipping flag for whichever CLI is selected.

## Changes

### Migration

Add `skipPermissions` integer column (default 1) to `aiReviewSettings` table. Run `bun run db:generate` after updating the schema to produce the migration file with correct naming and checksums — do not hand-author migration SQL.

### `cli-presets.ts`

Add an optional `permissionFlag?: string` field to the `CliPreset` type and each preset:

- Claude: `--dangerously-skip-permissions`
- Gemini: `--yolo`
- Codex: `--full-auto`
- OpenCode: undefined (no known permission flag — omit the field)

### `orchestrator.ts` — `startReview()`

After fetching settings and resolving the CLI preset, if `settings.skipPermissions` is truthy **and** `preset.permissionFlag` is defined, prepend the flag to the command — before `buildArgs()` output, between `preset.command` and the positional arguments. This ensures flags like `--dangerously-skip-permissions` are parsed as flags, not as part of the prompt string.

### `schema-ai-review.ts`

Add `skipPermissions` column definition to the `aiReviewSettings` table schema.

### `ai-review.ts` tRPC router

- `getSettings()`: include `skipPermissions` in the default row creation (default 1) and in the returned object.
- `updateSettings()`: accept `skipPermissions` boolean in the input schema, convert to 0/1 for SQLite, same as `autoReviewEnabled`.

Note: the orchestrator's own `getSettings()` function also seeds defaults — update both the tRPC router's and the orchestrator's default-creation logic.

### `SettingsView.tsx`

Add a toggle row after "Automatic Review": label "Auto-accept tool calls", subtitle "Skip permission prompts during AI review". Same visual pattern as the existing auto-review toggle. Defaults on.

## What does NOT change

- No changes to MCP server configuration
- No changes to prompt files or review artifacts
- No new tRPC endpoints — extends existing `getSettings`/`updateSettings`
- No changes to the review workspace or terminal launch flow
