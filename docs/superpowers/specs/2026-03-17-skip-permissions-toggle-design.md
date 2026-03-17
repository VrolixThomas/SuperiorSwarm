# Skip Permissions Toggle for AI Review Agents

## Problem

AI review agents (Claude, Gemini, Codex, OpenCode) launch without permission-skipping flags, so each tool call requires manual approval. For automated code review this is undesirable — the agents should run autonomously by default.

## Solution

A single "Auto-accept tool calls" toggle in Settings, defaulting to on. When enabled, the orchestrator appends the appropriate permission-skipping flag for whichever CLI is selected.

## Changes

### Migration 0012

Add `skipPermissions` integer column (default 1) to `aiReviewSettings` table.

### `cli-presets.ts`

Add a `permissionFlag` string field to each CLI preset:

- Claude: `--dangerously-skip-permissions`
- Gemini: `--yolo`
- Codex: `--full-auto`
- OpenCode: `--yolo`

### `orchestrator.ts` — `startReview()`

After fetching settings and resolving the CLI preset, if `settings.skipPermissions` is truthy, insert `preset.permissionFlag` into the command arguments before building the launch script.

### `schema-ai-review.ts`

Add `skipPermissions` column definition to the `aiReviewSettings` table schema.

### `ai-review.ts` tRPC router

- `getSettings()`: include `skipPermissions` in the default row creation (default 1) and in the returned object.
- `updateSettings()`: accept `skipPermissions` boolean in the input schema, convert to 0/1 for SQLite, same as `autoReviewEnabled`.

### `SettingsView.tsx`

Add a toggle row after "Automatic Review": label "Auto-accept tool calls", subtitle "Skip permission prompts during AI review". Same visual pattern as the existing auto-review toggle. Defaults on.

## What does NOT change

- No changes to MCP server configuration
- No changes to prompt files or review artifacts
- No new tRPC endpoints — extends existing `getSettings`/`updateSettings`
- No changes to the review workspace or terminal launch flow
