# Customizable Review Prompt

## Problem

The AI review prompt is hardcoded. Users cannot customize what the AI focuses on, what summary format to use, or add their own review guidelines. Different teams have different standards and the prompt should reflect that.

## Solution

Split the review prompt into three assembled sections:
1. **PR Context** (auto-generated, locked) — title, author, branches, provider
2. **User Guidelines** (editable) — what to focus on, summary format, tone, custom rules
3. **MCP Tool Instructions** (locked, always appended last) — ensures tools are used correctly regardless of user prompt length

Users edit their guidelines via a dedicated editor page accessible from Settings.

## Prompt Assembly

The final prompt written to `review-prompt.txt` is assembled as:

```
[PR Context — auto-generated]
You are reviewing Pull Request: {title}
Author: {author}
Source: {sourceBranch} → Target: {targetBranch}
Provider: {provider}

[User Guidelines — from DB, editable]
{customPrompt or DEFAULT_REVIEW_GUIDELINES}

[MCP Instructions — locked, always last]
You MUST use the BranchFlux MCP tools to complete your review:
1. Call `get_pr_metadata` to understand the PR context
2. Explore the codebase and review the changes (use git diff origin/{targetBranch}...HEAD)
3. For each issue or suggestion, call `add_draft_comment` with file path, line number, and comment
4. When done reviewing all files, call `set_review_summary` with a markdown summary including:
   - Overview of changes
   - Key changes per file
   - Risk assessment (Low/Medium/High)
   - Recommendations
5. Call `finish_review` to signal you are done
IMPORTANT: Do NOT modify any files. This is a read-only code review.
```

The MCP instructions are always appended last so they are closest to where the AI begins acting — this strongly enforces correct tool usage even with very long user prompts.

## Default Guidelines

The `DEFAULT_REVIEW_GUIDELINES` constant (defined in `cli-presets.ts`) contains the current hardcoded focus areas and summary format instructions that are currently embedded in `buildReviewPrompt()`:

```
Focus on: bugs, security issues, performance problems, code style, logic errors, and missing edge cases.
```

The step-4 sub-bullets (overview, key changes, risk assessment, recommendations) move into the locked MCP section since they describe how to use the `set_review_summary` tool, not review guidelines.

## Changes

### Database — `schema-ai-review.ts` + migration

Add `customPrompt` text column to `aiReviewSettings`. Null means use default. The default guidelines text is defined as a constant in `cli-presets.ts`, not stored in the DB. Run `bun run db:generate` to produce the migration.

### `cli-presets.ts` — `buildReviewPrompt()`

Refactor `buildReviewPrompt()` to accept an optional `customPrompt` parameter:
- Extract the current focus/style instructions into a `DEFAULT_REVIEW_GUIDELINES` exported constant
- Extract the MCP tool steps (including the step-4 sub-bullets for `set_review_summary`) into a `buildMcpInstructions(targetBranch)` function
- Assemble: PR context + (customPrompt ?? DEFAULT_REVIEW_GUIDELINES) + MCP instructions

### `orchestrator.ts` — `startReview()`

Pass `settings.customPrompt` to `buildReviewPrompt()`. The `getSettings()` default-row creation does not need to set `customPrompt` — it defaults to null in the schema, and `buildReviewPrompt()` falls back to the constant.

### tRPC — `ai-review.ts`

- `getSettings()`: return `customPrompt` (comes through from schema automatically)
- `updateSettings()`: accept `customPrompt` as `z.string().nullable().optional()` in input. When `undefined`, the field is not updated (existing pattern). When `null`, it is explicitly written to the DB to reset to default. When a non-null string, trim it — if empty/whitespace-only after trimming, store as `null` (fall back to default).

### Settings UI — `SettingsView.tsx`

Add a "Review Guidelines" row with an "Edit" button after the skip-permissions toggle. Clicking navigates to the editor.

Navigation: add a `settingsView: "main" | "prompt-editor"` state to `SettingsView` itself (local `useState`). When `"prompt-editor"`, render `ReviewPromptEditor` instead of the settings list. The back button sets it back to `"main"`.

### New component — `ReviewPromptEditor.tsx`

A full-page editor component rendered in place of the settings list:
- **Header:** back button (calls `onBack`), title "Review Guidelines", "Reset to Default" button, "Save" button
- **Editable area:** monospace textarea pre-filled with current `customPrompt ?? DEFAULT_REVIEW_GUIDELINES`
- **Locked preview:** read-only section below showing the MCP tool instructions with a lock icon label — not editable, just informational
- Save calls `updateSettings({ customPrompt: value })`, Reset calls `updateSettings({ customPrompt: null })` and refills the textarea with `DEFAULT_REVIEW_GUIDELINES`

## What does NOT change

- MCP server code — unchanged
- MCP tool instructions — always appended, never editable
- PR context generation — always auto-generated
- `cliFlags` column — unaffected, continues to be unused
- No new tRPC endpoints — extends existing `getSettings`/`updateSettings`
- No changes to how the launch script or terminal execution works
