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
{customPrompt or default guidelines}

[MCP Instructions — locked, always last]
You MUST use the BranchFlux MCP tools to complete your review:
1. Call `get_pr_metadata` to understand the PR context
2. Explore the codebase and review the changes (use git diff origin/{targetBranch}...HEAD)
3. For each issue or suggestion, call `add_draft_comment` with file path, line number, and comment
4. When done reviewing all files, call `set_review_summary` with a markdown summary
5. Call `finish_review` to signal you are done
IMPORTANT: Do NOT modify any files. This is a read-only code review.
```

The MCP instructions are always appended last so they are closest to where the AI begins acting — this strongly enforces correct tool usage even with very long user prompts.

## Changes

### Database — `schema-ai-review.ts` + migration

Add `customPrompt` text column to `aiReviewSettings`. Null means use default. The default guidelines text is defined as a constant in `cli-presets.ts`, not stored in the DB.

### `cli-presets.ts` — `buildReviewPrompt()`

Refactor `buildReviewPrompt()` to accept an optional `customPrompt` parameter:
- Extract the current "Focus on..." instructions into a `DEFAULT_REVIEW_GUIDELINES` exported constant
- Extract the MCP tool steps into a `MCP_INSTRUCTIONS` constant (takes `targetBranch` as parameter)
- Assemble: PR context + (customPrompt ?? DEFAULT_REVIEW_GUIDELINES) + MCP_INSTRUCTIONS

### `orchestrator.ts` — `startReview()`

Pass `settings.customPrompt` to `buildReviewPrompt()`.

### tRPC — `ai-review.ts`

- `getSettings()`: return `customPrompt` (already on the schema, comes through automatically)
- `updateSettings()`: accept `customPrompt: string | null` in input (null = reset to default)

### Settings UI — `SettingsView.tsx`

Add a "Review Guidelines" row with an "Edit" button after the skip-permissions toggle. The button navigates to the editor page.

### New component — `ReviewPromptEditor.tsx`

A full-page editor component (renders in place of SettingsView when active):
- **Header:** back button, title "Review Guidelines", "Reset to Default" button, "Save" button
- **Editable area:** monospace textarea pre-filled with current `customPrompt` or `DEFAULT_REVIEW_GUIDELINES`
- **Locked preview:** read-only section below showing the MCP tool instructions with a lock icon label
- Save calls `updateSettings({ customPrompt: value })`, Reset calls `updateSettings({ customPrompt: null })`

Navigation between SettingsView and ReviewPromptEditor is managed via local state in the parent (or a simple state in the project store).

## What does NOT change

- MCP server code — unchanged
- MCP tool instructions — always appended, never editable
- PR context generation — always auto-generated
- No new tRPC endpoints — extends existing `getSettings`/`updateSettings`
- No changes to how the launch script or terminal execution works
