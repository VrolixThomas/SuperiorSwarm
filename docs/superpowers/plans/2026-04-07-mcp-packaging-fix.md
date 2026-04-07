# MCP Server Packaging Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP standalone server available in both dev and packaged (production) Electron builds so AI review tools work for all users.

**Architecture:** Bundle `mcp-standalone/` with its `node_modules` into the packaged app via `electron-builder.yml`. Extract a shared `getMcpServerPath()` helper that resolves the correct path in both dev and production. Fix all 5 call sites that resolve the MCP server path.

**Tech Stack:** Electron, electron-builder, electron-vite, Node.js, Bun

---

## File Structure

| File | Role |
|------|------|
| `apps/desktop/electron-builder.yml` | Add `mcp-standalone/**/*` to files and asarUnpack |
| `apps/desktop/package.json` | Add postinstall step for mcp-standalone deps |
| `apps/desktop/src/main/ai-review/mcp-path.ts` | **NEW** — single `getMcpServerPath()` helper |
| `apps/desktop/src/main/ai-review/cli-presets.ts` | Use shared helper |
| `apps/desktop/src/main/ai-review/orchestrator.ts` | Use shared helper, remove stale `mcp-server.js` path |
| `apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts` | Use shared helper, remove stale `mcp-server.js` path |
| `apps/desktop/src/main/quick-actions/agent-setup.ts` | Use shared helper |

---

### Task 1: Create `getMcpServerPath()` helper

**Files:**
- Create: `apps/desktop/src/main/ai-review/mcp-path.ts`

- [ ] **Step 1: Create the helper module**

Create `apps/desktop/src/main/ai-review/mcp-path.ts`:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Resolve the absolute path to the MCP standalone server (server.mjs).
 *
 * In dev mode (electron-vite), app.getAppPath() returns the project root
 * (apps/desktop/) so the server is at <root>/mcp-standalone/server.mjs.
 *
 * In production, electron-builder packages the app into an .asar archive.
 * Because mcp-standalone contains native modules (better-sqlite3), it is
 * listed in asarUnpack and extracted to app.asar.unpacked/.
 * The path is <resources>/app.asar.unpacked/mcp-standalone/server.mjs.
 */
export function getMcpServerPath(): string {
	const appPath = app.getAppPath();

	// Production: app.getAppPath() ends with "app.asar"
	if (appPath.endsWith("app.asar")) {
		const unpackedPath = join(
			appPath.replace("app.asar", "app.asar.unpacked"),
			"mcp-standalone",
			"server.mjs"
		);
		if (existsSync(unpackedPath)) return unpackedPath;
	}

	// Dev: app.getAppPath() is the project root (apps/desktop/)
	const devPath = join(appPath, "mcp-standalone", "server.mjs");
	if (existsSync(devPath)) return devPath;

	throw new Error(
		`MCP server not found. Checked:\n  ${join(appPath, "mcp-standalone", "server.mjs")}`
	);
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/ai-review/mcp-path.ts
git commit -m "feat: add getMcpServerPath helper for dev and production"
```

---

### Task 2: Update `cli-presets.ts` to use shared helper

**Files:**
- Modify: `apps/desktop/src/main/ai-review/cli-presets.ts`

There are 3 presets that compute the standalone server path inline: `claude` (line 79), `gemini` (line 111), `opencode` (line 167). Plus `codex` uses `opts.mcpServerPath`. All should use the shared helper via `LaunchOptions`.

- [ ] **Step 1: Import the helper and use it in `LaunchOptions`**

In `apps/desktop/src/main/ai-review/cli-presets.ts`, remove the `dirname` import since it will no longer be needed:

Change line 3 from:
```typescript
import { dirname, join, resolve } from "node:path";
```
To:
```typescript
import { join } from "node:path";
```

- [ ] **Step 2: Replace inline path resolution in `claude` preset**

Replace the `claude.setupMcp` function (lines 76-101):

```typescript
setupMcp: (opts) => {
	const configPath = join(opts.worktreePath, ".mcp.json");
	const config = {
		mcpServers: {
			superiorswarm: {
				command: "node",
				args: [opts.mcpServerPath],
				env: buildMcpEnv(opts),
			},
		},
	};
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	return () => {
		try {
			rmSync(configPath);
		} catch {}
	};
},
```

- [ ] **Step 3: Replace inline path resolution in `gemini` preset**

Replace the `gemini.setupMcp` function (lines 109-136):

```typescript
setupMcp: (opts) => {
	const dir = join(opts.worktreePath, ".gemini");
	mkdirSync(dir, { recursive: true });
	const configPath = join(dir, "settings.json");
	const config = {
		mcpServers: {
			superiorswarm: {
				command: "node",
				args: [opts.mcpServerPath],
				env: buildMcpEnv(opts),
			},
		},
	};
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	return () => {
		try {
			rmSync(configPath);
			rmSync(dir, { recursive: true });
		} catch {}
	};
},
```

- [ ] **Step 4: Replace inline path resolution in `opencode` preset**

Replace the `opencode.setupMcp` function (lines 165-189):

```typescript
setupMcp: (opts) => {
	const configPath = join(opts.worktreePath, "opencode.json");
	const config = {
		mcp: {
			superiorswarm: {
				type: "local",
				command: ["node", opts.mcpServerPath],
				environment: buildMcpEnv(opts),
			},
		},
	};
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	return () => {
		try {
			rmSync(configPath);
		} catch {}
	};
},
```

- [ ] **Step 5: Clean up unused `writeTempMcpConfig` helper**

The `writeTempMcpConfig` function (lines 30-49) is now only used by the `codex` preset, and it already uses `opts.mcpServerPath`. Verify `codex` still works — it passes `opts.mcpServerPath` to `writeTempMcpConfig`, which is correct since the orchestrator will now set `mcpServerPath` from the shared helper.

The `resolve` import can also be removed from the import on line 3 since all presets now use `opts.mcpServerPath` instead of computing paths with `resolve(dirname(__dirname), ...)`.

Remove `resolve` from the import:
```typescript
import { join } from "node:path";
```

Also remove the now-unused `dirname` from the imports if present (check if `dirname` is still used anywhere in the file — it should not be after removing the inline path computations).

- [ ] **Step 6: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/ai-review/cli-presets.ts
git commit -m "refactor: use shared mcpServerPath in all CLI presets"
```

---

### Task 3: Update `orchestrator.ts` to use shared helper

**Files:**
- Modify: `apps/desktop/src/main/ai-review/orchestrator.ts`

There are two places where the stale `mcp-server.js` path is used: lines 291 and 563.

- [ ] **Step 1: Add import**

Add at the top of `apps/desktop/src/main/ai-review/orchestrator.ts`:

```typescript
import { getMcpServerPath } from "./mcp-path";
```

- [ ] **Step 2: Fix line 291**

Change:
```typescript
const mcpServerPath = resolve(__dirname, "mcp-server.js");
```
To:
```typescript
const mcpServerPath = getMcpServerPath();
```

- [ ] **Step 3: Fix line 563 (follow-up review path)**

Find the second occurrence of `resolve(__dirname, "mcp-server.js")` (around line 563) and apply the same change:

Change:
```typescript
const mcpServerPath = resolve(__dirname, "mcp-server.js");
```
To:
```typescript
const mcpServerPath = getMcpServerPath();
```

- [ ] **Step 4: Clean up unused `resolve` import if applicable**

Check if `resolve` from `node:path` is still used elsewhere in the file. If not, remove it from the import. (It's likely still used elsewhere — check before removing.)

- [ ] **Step 5: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ai-review/orchestrator.ts
git commit -m "fix: use getMcpServerPath in orchestrator instead of stale mcp-server.js"
```

---

### Task 4: Update `comment-solver-orchestrator.ts` to use shared helper

**Files:**
- Modify: `apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts`

- [ ] **Step 1: Add import**

Add at the top of the file:

```typescript
import { getMcpServerPath } from "./mcp-path";
```

- [ ] **Step 2: Fix stale path on line 96**

Change:
```typescript
const mcpServerPath = resolve(__dirname, "mcp-server.js");
```
To:
```typescript
const mcpServerPath = getMcpServerPath();
```

- [ ] **Step 3: Clean up unused `resolve` import if applicable**

Check if `resolve` is still used elsewhere in the file. If the only usage was for the MCP path, remove it from the import.

- [ ] **Step 4: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai-review/comment-solver-orchestrator.ts
git commit -m "fix: use getMcpServerPath in comment solver orchestrator"
```

---

### Task 5: Update `agent-setup.ts` to use shared helper

**Files:**
- Modify: `apps/desktop/src/main/quick-actions/agent-setup.ts`

- [ ] **Step 1: Add import and replace path**

Add import:
```typescript
import { getMcpServerPath } from "../ai-review/mcp-path";
```

Change line 64 from:
```typescript
const standaloneServerPath = resolve(dirname(__dirname), "..", "mcp-standalone", "server.mjs");
```
To:
```typescript
const standaloneServerPath = getMcpServerPath();
```

- [ ] **Step 2: Clean up unused imports**

Remove `dirname` from `node:path` import if no longer used elsewhere in the file. Also remove `resolve` if no longer used.

- [ ] **Step 3: Verify type-check passes**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/quick-actions/agent-setup.ts
git commit -m "fix: use getMcpServerPath in agent-setup"
```

---

### Task 6: Add `mcp-standalone` to electron-builder packaging

**Files:**
- Modify: `apps/desktop/electron-builder.yml`

- [ ] **Step 1: Add `mcp-standalone` to `files` and `asarUnpack`**

In `apps/desktop/electron-builder.yml`, update the `files` section:

```yaml
files:
  - out/**/*
  - mcp-standalone/**/*
```

Update the `asarUnpack` section to include the mcp-standalone directory (it uses `better-sqlite3` which is a native module that must be unpacked):

```yaml
asarUnpack:
  - "node_modules/better-sqlite3/**/*"
  - "node_modules/node-pty/**/*"
  - "node_modules/bindings/**/*"
  - "node_modules/file-uri-to-path/**/*"
  - "out/main/db/migrations/**/*"
  - "mcp-standalone/**/*"
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/electron-builder.yml
git commit -m "fix: include mcp-standalone in packaged app"
```

---

### Task 7: Add postinstall hook for `mcp-standalone` dependencies

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Update postinstall script**

In `apps/desktop/package.json`, the current `postinstall` script is:

```json
"postinstall": "[ ! -d node_modules/node-pty ] || find node_modules/node-pty -name spawn-helper -exec chmod +x {} + && electron-rebuild -f -w better-sqlite3"
```

Prepend the mcp-standalone install:

```json
"postinstall": "cd mcp-standalone && npm install --no-audit --no-fund && cd .. && [ ! -d node_modules/node-pty ] || find node_modules/node-pty -name spawn-helper -exec chmod +x {} + && electron-rebuild -f -w better-sqlite3"
```

- [ ] **Step 2: Test the postinstall runs**

Run: `cd apps/desktop && rm -rf mcp-standalone/node_modules && bun install`

Verify `mcp-standalone/node_modules/@modelcontextprotocol` exists after the install completes:

```bash
ls apps/desktop/mcp-standalone/node_modules/@modelcontextprotocol/sdk
```
Expected: directory exists with package contents

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json
git commit -m "fix: auto-install mcp-standalone deps in postinstall"
```

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Verify all MCP path references are consistent**

Run: `cd apps/desktop && grep -rn "mcp-server\.js\|mcp-standalone/server\.mjs" src/`

Expected: Zero results for `mcp-server.js` (all removed). Zero results for `mcp-standalone/server.mjs` (all replaced by `getMcpServerPath()`). The only reference should be in the new `mcp-path.ts` helper.

- [ ] **Step 2: Run type-check**

Run: `cd apps/desktop && bun run type-check`
Expected: No errors

- [ ] **Step 3: Run tests**

Run: `cd apps/desktop && bun test`
Expected: All pass

- [ ] **Step 4: Run lint**

Run: `bun run check`
Expected: No new errors

- [ ] **Step 5: Verify dev mode path resolution works**

Run a quick Node.js check in the context of the project:

```bash
cd apps/desktop && node -e "
const { join } = require('path');
const { existsSync } = require('fs');
const p = join(process.cwd(), 'mcp-standalone', 'server.mjs');
console.log('Dev path:', p);
console.log('Exists:', existsSync(p));
console.log('node_modules:', existsSync(join(process.cwd(), 'mcp-standalone', 'node_modules', '@modelcontextprotocol')));
"
```

Expected output:
```
Dev path: .../apps/desktop/mcp-standalone/server.mjs
Exists: true
node_modules: true
```
