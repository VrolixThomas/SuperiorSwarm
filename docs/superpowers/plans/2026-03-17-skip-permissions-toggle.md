# Skip Permissions Toggle — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single toggle to Settings that makes AI review agents skip permission prompts by passing the right CLI flag.

**Architecture:** New `skipPermissions` column in `aiReviewSettings`, optional `permissionFlag` on CLI presets, orchestrator injects the flag into the command when enabled.

**Tech Stack:** Drizzle ORM, SQLite, tRPC, React, TypeScript

---

## Chunk 1: Implementation

### Task 1: Schema + Migration

**Files:**
- Modify: `apps/desktop/src/main/db/schema-ai-review.ts:4-11`

- [ ] **Step 1: Add `skipPermissions` column to schema**

In `schema-ai-review.ts`, add the column to `aiReviewSettings` after `autoReviewEnabled` (line 8):

```typescript
export const aiReviewSettings = sqliteTable("ai_review_settings", {
	id: text("id").primaryKey(),
	cliPreset: text("cli_preset").notNull().default("claude"),
	cliFlags: text("cli_flags"),
	autoReviewEnabled: integer("auto_review_enabled").notNull().default(0),
	skipPermissions: integer("skip_permissions").notNull().default(1),
	maxConcurrentReviews: integer("max_concurrent_reviews").notNull().default(3),
	updatedAt: integer("updated_at", { mode: "timestamp" }),
});
```

- [ ] **Step 2: Generate migration**

Run: `cd apps/desktop && bun run db:generate`
Expected: A new migration file created in `src/main/db/migrations/`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/db/schema-ai-review.ts apps/desktop/src/main/db/migrations/
git commit -m "feat: add skipPermissions column to aiReviewSettings"
```

### Task 2: CLI Presets

**Files:**
- Modify: `apps/desktop/src/main/ai-review/cli-presets.ts:5-11`

- [ ] **Step 1: Add `permissionFlag` to `CliPreset` interface**

At line 5, update the interface:

```typescript
export interface CliPreset {
	name: string;
	label: string;
	command: string;
	permissionFlag?: string;
	buildArgs: (opts: LaunchOptions) => string[];
	setupMcp?: (opts: LaunchOptions) => CleanupFn;
}
```

- [ ] **Step 2: Add `permissionFlag` to each preset that supports it**

In the `CLI_PRESETS` object, add `permissionFlag` to each preset (after the `command` field):

```typescript
claude: {
	name: "claude",
	label: "Claude Code",
	command: "claude",
	permissionFlag: "--dangerously-skip-permissions",
	// ... rest unchanged
},
gemini: {
	name: "gemini",
	label: "Gemini CLI",
	command: "gemini",
	permissionFlag: "--yolo",
	// ... rest unchanged
},
codex: {
	name: "codex",
	label: "Codex",
	command: "codex",
	permissionFlag: "--full-auto",
	// ... rest unchanged
},
opencode: {
	name: "opencode",
	label: "OpenCode",
	command: "opencode",
	// no permissionFlag — OpenCode has no known equivalent
	// ... rest unchanged
},
```

- [ ] **Step 3: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/cli-presets.ts
git commit -m "feat: add permissionFlag to CLI presets"
```

### Task 3: Orchestrator + tRPC

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts:83-94,382-384`
- Modify: `apps/desktop/src/main/trpc/routers/ai-review.ts:20-45`

- [ ] **Step 1: Update default row creation in orchestrator `getSettings()`**

In `orchestrator.ts`, update the `.values()` call at line 87 to include `skipPermissions`:

```typescript
	db.insert(schema.aiReviewSettings)
		.values({
			id: "default",
			cliPreset: "claude",
			autoReviewEnabled: 0,
			skipPermissions: 1,
			maxConcurrentReviews: 3,
			updatedAt: now,
		})
		.run();
```

- [ ] **Step 2: Inject permission flag into CLI command**

In `orchestrator.ts`, replace the command-building block at line 382-384:

```typescript
		// Build the CLI command args
		const args = preset.buildArgs(launchOpts);
		const parts = [preset.command];
		if (settings.skipPermissions && preset.permissionFlag) {
			parts.push(preset.permissionFlag);
		}
		parts.push(...args);
		const cliCommand = parts.join(" ");
```

- [ ] **Step 3: Extend `updateSettings` input in tRPC router**

In `ai-review.ts`, add `skipPermissions` to the input schema (line 25):

```typescript
	updateSettings: publicProcedure
		.input(
			z.object({
				cliPreset: z.enum(["claude", "gemini", "codex", "opencode"]).optional(),
				autoReviewEnabled: z.boolean().optional(),
				skipPermissions: z.boolean().optional(),
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
			if (input.maxConcurrentReviews !== undefined)
				updates.maxConcurrentReviews = input.maxConcurrentReviews;

			db.update(schema.aiReviewSettings)
				.set(updates)
				.where(eq(schema.aiReviewSettings.id, "default"))
				.run();

			return getSettings();
		}),
```

- [ ] **Step 4: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts apps/desktop/src/main/trpc/routers/ai-review.ts
git commit -m "feat: inject permission flag in orchestrator and expose in tRPC"
```

### Task 4: Settings UI

**Files:**
- Modify: `apps/desktop/src/renderer/components/SettingsView.tsx:264-265`

- [ ] **Step 1: Add toggle after "Automatic Review"**

In `SettingsView.tsx`, after the Auto Review toggle closing `</div>` (line 264) and before the "Max Concurrent Reviews" section (line 266), insert:

```tsx
					{/* Skip Permissions Toggle */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">
								Auto-accept tool calls
							</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								Skip permission prompts during AI review
							</span>
						</div>
						<button
							type="button"
							onClick={() =>
								updateAiSettings.mutate({
									skipPermissions: !(aiSettings?.skipPermissions ?? true),
								})
							}
							className={`relative h-[22px] w-[40px] rounded-full transition-colors ${
								(aiSettings?.skipPermissions ?? true)
									? "bg-[var(--accent)]"
									: "bg-[var(--bg-elevated)]"
							}`}
						>
							<div
								className={`absolute top-[2px] size-[18px] rounded-full bg-white transition-transform ${
									(aiSettings?.skipPermissions ?? true)
										? "translate-x-[20px]"
										: "translate-x-[2px]"
								}`}
							/>
						</button>
					</div>
```

- [ ] **Step 2: Verify build**

Run: `cd apps/desktop && bun run type-check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/SettingsView.tsx
git commit -m "feat: add auto-accept tool calls toggle to settings UI"
```
