# Customizable Review Prompt — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users customize the AI review guidelines while keeping MCP tool instructions locked and always enforced.

**Architecture:** Split `buildReviewPrompt()` into three sections (PR context, user guidelines, MCP instructions). Store custom prompt in `aiReviewSettings.customPrompt`. Add a full-page editor component accessible from Settings.

**Tech Stack:** Drizzle ORM, SQLite, tRPC, React, TypeScript, Tailwind CSS

---

## File Structure

- Modify: `apps/desktop/src/main/db/schema-ai-review.ts` — add `customPrompt` column
- Modify: `apps/desktop/src/main/ai-review/cli-presets.ts` — refactor `buildReviewPrompt()`, export constants
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts` — pass `customPrompt` to prompt builder
- Modify: `apps/desktop/src/main/trpc/routers/ai-review.ts` — extend `updateSettings` input
- Modify: `apps/desktop/src/renderer/components/SettingsView.tsx` — add "Review Guidelines" row + navigation state
- Create: `apps/desktop/src/renderer/components/ReviewPromptEditor.tsx` — full-page editor

---

### Task 1: Schema + Migration

**Files:**
- Modify: `apps/desktop/src/main/db/schema-ai-review.ts:4-12`

- [ ] **Step 1: Add `customPrompt` column**

In `schema-ai-review.ts`, add after `skipPermissions` (line 9):

```typescript
export const aiReviewSettings = sqliteTable("ai_review_settings", {
	id: text("id").primaryKey(),
	cliPreset: text("cli_preset").notNull().default("claude"),
	cliFlags: text("cli_flags"),
	autoReviewEnabled: integer("auto_review_enabled").notNull().default(0),
	skipPermissions: integer("skip_permissions").notNull().default(1),
	customPrompt: text("custom_prompt"),
	maxConcurrentReviews: integer("max_concurrent_reviews").notNull().default(3),
	updatedAt: integer("updated_at", { mode: "timestamp" }),
});
```

- [ ] **Step 2: Generate migration**

Run: `cd apps/desktop && bun run db:generate`
Expected: New migration file in `src/main/db/migrations/`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/db/schema-ai-review.ts apps/desktop/src/main/db/migrations/
git commit -m "feat: add customPrompt column to aiReviewSettings"
```

### Task 2: Refactor `buildReviewPrompt()`

**Files:**
- Modify: `apps/desktop/src/main/ai-review/cli-presets.ts:146-173`

- [ ] **Step 1: Extract constants and refactor the function**

Replace the entire `buildReviewPrompt` function (lines 146-173) with:

```typescript
/** Default review guidelines — used when user hasn't set a custom prompt */
export const DEFAULT_REVIEW_GUIDELINES = `Focus on: bugs, security issues, performance problems, code style, logic errors, and missing edge cases.

IMPORTANT: Do NOT modify any files. This is a read-only code review.`;

/** Build the locked MCP tool instructions block */
function buildMcpInstructions(targetBranch: string): string {
	return `
You MUST use the BranchFlux MCP tools to complete your review:

1. Call \`get_pr_metadata\` to understand the PR context
2. Explore the codebase and review the changes (use git diff origin/${targetBranch}...HEAD to see the changes)
3. For each issue or suggestion, call \`add_draft_comment\` with the file path, line number, and your comment
4. When done reviewing all files, call \`set_review_summary\` with a markdown summary including:
   - Overview of changes
   - Key changes per file
   - Risk assessment (Low/Medium/High)
   - Recommendations
5. Call \`finish_review\` to signal you are done

IMPORTANT: You MUST call finish_review when done. Do NOT skip any MCP tool steps.`;
}

/** Build the review prompt from PR metadata */
export function buildReviewPrompt(metadata: {
	title: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	provider: string;
	customPrompt?: string | null;
}): string {
	const prContext = `You are reviewing Pull Request: ${metadata.title}
Author: ${metadata.author}
Source: ${metadata.sourceBranch} → Target: ${metadata.targetBranch}
Provider: ${metadata.provider}`;

	const guidelines = metadata.customPrompt?.trim() || DEFAULT_REVIEW_GUIDELINES;
	const mcpInstructions = buildMcpInstructions(metadata.targetBranch);

	return `${prContext}\n\n${guidelines}\n${mcpInstructions}`;
}
```

- [ ] **Step 2: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/ai-review/cli-presets.ts
git commit -m "refactor: split buildReviewPrompt into context, guidelines, and MCP sections"
```

### Task 3: Orchestrator + tRPC

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts:355-365`
- Modify: `apps/desktop/src/main/trpc/routers/ai-review.ts:20-47`

- [ ] **Step 1: Pass `customPrompt` in orchestrator**

In `orchestrator.ts`, update the `buildReviewPrompt` call (lines 357-363):

```typescript
		writeFileSync(
			promptFilePath,
			buildReviewPrompt({
				title: draft.prTitle,
				author: draft.prAuthor,
				sourceBranch: draft.sourceBranch,
				targetBranch: draft.targetBranch,
				provider: draft.prProvider,
				customPrompt: settings.customPrompt,
			}),
			"utf-8"
		);
```

- [ ] **Step 2: Extend `updateSettings` in tRPC router**

In `ai-review.ts`, add `customPrompt` to the input schema (after line 25):

```typescript
	updateSettings: publicProcedure
		.input(
			z.object({
				cliPreset: z.enum(["claude", "gemini", "codex", "opencode"]).optional(),
				autoReviewEnabled: z.boolean().optional(),
				skipPermissions: z.boolean().optional(),
				customPrompt: z.string().nullable().optional(),
				maxConcurrentReviews: z.number().min(1).max(10).optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const now = new Date();
			const updates: Record<string, unknown> = { updatedAt: now };

			if (input.cliPreset !== undefined) updates.cliPreset = input.cliPreset;
			if (input.autoReviewEnabled !== undefined)
				updates.autoReviewEnabled = input.autoReviewEnabled ? 1 : 0;
			if (input.skipPermissions !== undefined)
				updates.skipPermissions = input.skipPermissions ? 1 : 0;
			if (input.customPrompt !== undefined) {
				// null = reset to default; empty/whitespace = also reset to default
				const trimmed = input.customPrompt?.trim();
				updates.customPrompt = trimmed || null;
			}
			if (input.maxConcurrentReviews !== undefined)
				updates.maxConcurrentReviews = input.maxConcurrentReviews;

			db.update(schema.aiReviewSettings)
				.set(updates)
				.where(eq(schema.aiReviewSettings.id, "default"))
				.run();

			return getSettings();
		}),
```

- [ ] **Step 3: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts apps/desktop/src/main/trpc/routers/ai-review.ts
git commit -m "feat: pass customPrompt through orchestrator and tRPC"
```

### Task 4: ReviewPromptEditor component

**Files:**
- Create: `apps/desktop/src/renderer/components/ReviewPromptEditor.tsx`

- [ ] **Step 1: Create the editor component**

Create `apps/desktop/src/renderer/components/ReviewPromptEditor.tsx`:

```tsx
import { useEffect, useState } from "react";
import { DEFAULT_REVIEW_GUIDELINES } from "../../main/ai-review/cli-presets";
import { trpc } from "../trpc/client";

export function ReviewPromptEditor({ onBack }: { onBack: () => void }) {
	const utils = trpc.useUtils();
	const { data: settings } = trpc.aiReview.getSettings.useQuery(undefined, {
		staleTime: 30_000,
	});
	const updateSettings = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	const [value, setValue] = useState("");
	const [dirty, setDirty] = useState(false);

	// Initialize textarea when settings load
	useEffect(() => {
		if (settings) {
			setValue(settings.customPrompt ?? DEFAULT_REVIEW_GUIDELINES);
		}
	}, [settings]);

	const handleSave = () => {
		updateSettings.mutate({ customPrompt: value });
		setDirty(false);
	};

	const handleReset = () => {
		updateSettings.mutate({ customPrompt: null });
		setValue(DEFAULT_REVIEW_GUIDELINES);
		setDirty(false);
	};

	const handleChange = (newValue: string) => {
		setValue(newValue);
		setDirty(true);
	};

	const isCustom = settings?.customPrompt != null;

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 pb-3">
				<button
					type="button"
					onClick={onBack}
					className="flex size-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<path
							d="M10 3L5 8l5 5"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<span className="flex-1 text-[13px] font-semibold text-[var(--text)]">
					Review Guidelines
				</span>
				{isCustom && (
					<button
						type="button"
						onClick={handleReset}
						className="rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)]"
					>
						Reset to Default
					</button>
				)}
				<button
					type="button"
					onClick={handleSave}
					disabled={!dirty || updateSettings.isPending}
					className="rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					{updateSettings.isPending ? "Saving..." : "Save"}
				</button>
			</div>

			<div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3">
				{/* Editable guidelines */}
				<div className="flex flex-col gap-1">
					<span className="text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
						Your Review Instructions
					</span>
					<textarea
						value={value}
						onChange={(e) => handleChange(e.target.value)}
						spellCheck={false}
						className="min-h-[200px] flex-1 resize-y rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent)]"
						placeholder="Enter your review guidelines..."
					/>
				</div>

				{/* Locked MCP preview */}
				<div className="flex flex-col gap-1 pb-3">
					<span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
						<svg
							aria-hidden="true"
							width="10"
							height="10"
							viewBox="0 0 16 16"
							fill="currentColor"
						>
							<path d="M4 7V5a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1zm2 0h4V5a2 2 0 1 0-4 0v2z" />
						</svg>
						MCP Tool Instructions (always appended)
					</span>
					<div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-quaternary)] opacity-70">
						<p>1. Call `get_pr_metadata` to get PR context</p>
						<p>2. Explore codebase and review changes via git diff</p>
						<p>3. Call `add_draft_comment` for each issue found</p>
						<p>
							4. Call `set_review_summary` with markdown summary
							(overview, changes per file, risk, recommendations)
						</p>
						<p>5. Call `finish_review` when done</p>
					</div>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/ReviewPromptEditor.tsx
git commit -m "feat: add ReviewPromptEditor component"
```

### Task 5: Settings UI integration

**Files:**
- Modify: `apps/desktop/src/renderer/components/SettingsView.tsx:58,297-298`

- [ ] **Step 1: Add navigation state and import**

At the top of `SettingsView.tsx`, add the import:

```typescript
import { ReviewPromptEditor } from "./ReviewPromptEditor";
```

Inside `SettingsView()` (after line 58), add:

```typescript
const [view, setView] = useState<"main" | "prompt-editor">("main");

if (view === "prompt-editor") {
	return <ReviewPromptEditor onBack={() => setView("main")} />;
}
```

Also add `useState` to the React import if not already there.

- [ ] **Step 2: Add "Review Guidelines" row**

After the skip-permissions toggle closing `</div>` (line 297) and before the Max Concurrent Reviews comment (line 299), insert:

```tsx
					{/* Review Guidelines */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">
								Review Guidelines
							</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								{aiSettings?.customPrompt
									? "Custom instructions"
									: "Default instructions"}
							</span>
						</div>
						<button
							type="button"
							onClick={() => setView("prompt-editor")}
							className="rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
						>
							Edit
						</button>
					</div>
```

- [ ] **Step 3: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/SettingsView.tsx
git commit -m "feat: add review guidelines row and editor navigation to settings"
```
