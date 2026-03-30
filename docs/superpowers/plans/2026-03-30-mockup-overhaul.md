# Website Mockup Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invented mockup components with pixel-accurate replicas of the real SuperiorSwarm desktop app, based on screenshots of the actual running application.

**Architecture:** Rewrite all 7 mockup component files and the mock data to match the real app's visual design. The mockup-shell structure (3-panel layout, segment switching) stays — but every panel's content gets rebuilt. The right panel gains a toolbar with switchable views (git changes, file tree, PR comments, overview). The center panel gains a proper tab bar. Mock data is updated to use SuperiorSwarm's real project/PR/ticket data visible in the screenshots.

**Tech Stack:** Same as before — React 19, Tailwind CSS v4, no new dependencies.

---

## What Changes (Summary from Screenshots)

| Component | Current (wrong) | Real app (target) |
|-----------|-----------------|-------------------|
| **Sidebar - Repos** | Project list + "Active Agents" cards with pulsing dots | Project names with expandable branch list, "✓ comments resolved" subtitles, "+ Add Repository" |
| **Sidebar - PRs** | Simple PR list with CI/review badges | PRs grouped by repo ("VROLIXTHOMAS/SUPERIORSWARM-TE..."), author + green/yellow status dots |
| **Sidebar - Tickets** | Nothing shown | "All Tickets" button with count, LINEAR section with project names |
| **Center - Terminal** | OK but tab bar wrong | Proper tab bar with numbered tabs, "* Claude Code ×" style, "PR #1" label below |
| **Center - Tickets** | Basic 4-column kanban only | Board/List/Table toggle, proper status circle icons (○ ◎ ◐ ●), "Linear" badges on cards, header with "All Tickets · All providers · 3 tickets" |
| **Right panel** | Single view (review findings) | Toolbar with 4 icon buttons switching between: git changes, file tree, PR comments, branch overview |
| **Right - Git Changes** | Doesn't exist | Branch selector, WORKING CHANGES with staging/commit, COMMITS list, BRANCH CHANGES file tree |
| **Right - PR Comments** | Simplified review findings | "Pull Request #1 · 24 comments", threads grouped by file, "Resolve"/"Skip" per comment, "Solve with AI" button |
| **Right - File Tree** | Doesn't exist | Search input, collapsible directory tree with file type icons |
| **Right - Branch Overview** | Doesn't exist | Branch info, BRANCH CHANGES file list, COMMITS section |
| **Comment Solver** | Simplified fix group | Center becomes diff editor (side-by-side), right shows COMMIT GROUPS with approve/follow-up, "Push changes & post replies" |

## File Structure

### Files to Rewrite (complete replacement)
| File | Responsibility |
|------|---------------|
| `src/components/mockup/mock-data.ts` | All fake data matching real screenshots |
| `src/components/mockup/sidebar.tsx` | Repos view with branches, Tickets sidebar, PRs grouped by repo |
| `src/components/mockup/terminal-view.tsx` | Proper tab bar style, Claude Code welcome, "PR #1" label |
| `src/components/mockup/ticket-board-view.tsx` | Full tickets canvas with Board/List/Table toggle, proper header, status icons |
| `src/components/mockup/pr-detail-view.tsx` | Side-by-side diff editor with line numbers, file tabs |
| `src/components/mockup/review-panel.tsx` | Toolbar-switched right panel: git changes, file tree, PR comments, overview |
| `src/components/mockup/comment-solver-view.tsx` | Commit groups with approve/follow-up, nested comment threads, push/revert bar |

### Files to Modify
| File | Changes |
|------|---------|
| `src/components/mockup/mockup-shell.tsx` | Update state to support right panel view switching, adjust panel widths, update tab bar |

### Files Unchanged
| File | Reason |
|------|--------|
| `src/components/animated-logo.tsx` | Already correct |
| `src/components/hero.tsx` | Already correct |
| `src/components/nav.tsx` | Already correct |
| `src/components/feature-cards.tsx` | Already correct |
| `src/components/cta-footer.tsx` | Already correct |

---

## Task 1: Rewrite mock data to match real screenshots

**Files:**
- Rewrite: `src/components/mockup/mock-data.ts`

- [ ] **Step 1: Replace mock-data.ts with data from real screenshots**

The data must match what's visible in the screenshots. Replace the entire file:

```ts
// Projects with expandable branches (from screenshot 1)
export const PROJECTS = [
	{
		name: "superiorswarm-test",
		branches: [
			{ name: "main", active: false },
			{ name: "tset", active: false },
			{
				name: "test/ai-review-20260329170028",
				active: true,
				subtitle: "✓ comments resolved",
			},
		],
	},
	{
		name: "BranchFlux",
		branches: [{ name: "main", active: false }],
	},
] as const;

// PR list grouped by repo (from screenshot 8)
export const PULL_REQUESTS = [
	{
		repo: "VROLIXTHOMAS/SUPERIORSWARM-TE...",
		prs: [
			{
				id: 2,
				title: "Add initial Claude README file",
				branch: "SimonVrolix-patch-1",
				target: "main",
				author: "SimonVrolix",
				authorInitial: "S",
				status: "success" as const,
			},
		],
	},
	{
		repo: "VROLIXTHOMAS/SLACKBOT",
		prs: [
			{
				id: 21,
				title: "Add comment to test_readme.md",
				branch: "SimonVrolix-patch-3",
				target: "main",
				author: "SimonVrolix",
				authorInitial: "S",
				status: "success" as const,
			},
		],
	},
] as const;

// Tickets (from screenshot 5-7)
export const TICKETS = [
	{
		key: "SUP-5",
		title: "Add automatic pr review using programmatic tool calling",
		status: "Backlog" as const,
		provider: "Linear" as const,
		project: "SuperiorSet",
	},
	{
		key: "SUP-7",
		title: "Add buttons for common things such as run build/tests",
		status: "Todo" as const,
		provider: "Linear" as const,
		project: "SuperiorSet",
	},
	{
		key: "SUP-6",
		title: "Inline Agent chatting",
		status: "In Progress" as const,
		provider: "Linear" as const,
		project: "SuperiorSet",
	},
] as const;

export const TICKET_STATUSES = [
	{ name: "Backlog", icon: "○", color: "text-text-faint" },
	{ name: "Todo", icon: "◎", color: "text-text-muted" },
	{ name: "In Progress", icon: "◐", color: "text-yellow" },
	{ name: "Done", icon: "●", color: "text-green" },
] as const;

// Terminal lines (from screenshot 1 — Claude Code welcome)
export const TERMINAL_LINES = [
	{ type: "shell" as const, text: "thomas@Thomass-Mac-mini ai-review-20260329170028 % " },
	{ type: "shell" as const, text: "thomas@Thomass-Mac-mini ai-review-20260329170028 % claude" },
] as const;

// PR comments / review threads (from screenshot 3)
export const PR_COMMENTS = [
	{
		file: "src/api/user-service.ts",
		threads: [
			{
				line: 16,
				author: "VrolixThomas",
				date: "3/29/2026",
				text: 'This is vulnerable to SQL injection. The `userId` parameter is concatenated directly into the query string. Use parameterized queries instead.',
			},
			{
				line: 16,
				author: "VrolixThomas",
				date: "3/29/2026",
				text: "Don't hardcode API keys. Move this to environment variables and use `process.env.API_KEY`. This would also get flagged by any secret scanner in CI.",
			},
			{
				line: 31,
				author: "VrolixThomas",
				date: "3/29/2026",
				text: "XSS vulnerability. `user.bio` could contain `<script>` tags. Sanitize HTML output or use a template engine that auto-escapes.",
			},
			{
				line: 36,
				author: "VrolixThomas",
				date: "3/29/2026",
				text: "`Access-Control-Allow-Origin: *` with `Allow-Credentials: true` is a security misconfiguration. Browsers will reject this combination, and even without credentials, a wildcard origin is too permissive for production. Allowlist specific origins.",
			},
		],
	},
] as const;

// Comment solver commit groups (from screenshot 4)
export const COMMIT_GROUPS = [
	{
		label: "SQL injection vulnerabilities across all files",
		resolved: 3,
		total: 3,
		approved: true,
		commits: ["203c6c9"],
		files: ["user-service.ts", "order-processor.ts"],
		comments: [
			{
				file: "user-service.ts",
				line: 16,
				author: "VrolixThomas",
				text: 'This is vulnerable to SQL injection. The `userId` parameter is concatenated directly into the query string. Use parameterized queries instead.',
			},
			{
				file: "user-service.ts",
				line: 16,
				author: "VrolixThomas",
				text: "To clarify — an attacker could pass `'; DROP TABLE users; --` as the userId and destroy the entire table. The `updateUserBio` function below has the same issue.",
			},
			{
				file: "order-processor.ts",
				line: 16,
				author: "VrolixThomas",
				text: "The SQL injection in the coupon query and the order insert is also concerning — same pattern as user-service.ts. Parameterize all queries.",
			},
		],
	},
	{
		label: "Security hardening in user-service (API key, XSS, CORS)",
		resolved: 3,
		total: 3,
		approved: true,
		commits: ["0307f15"],
		files: ["user-service.ts"],
		comments: [],
	},
	{
		label: "Performance optimizations in data-processing.ts",
		resolved: 4,
		total: 4,
		approved: true,
		commits: [],
		files: ["data-processing.ts"],
		comments: [],
	},
] as const;

// Diff lines for the solver center panel (from screenshot 4)
export const DIFF_LINES = [
	{ type: "info" as const, left: "", right: "", content: "// Each issue is marked with @review-target for automated comment placement." },
	{ type: "context" as const, left: "3", right: "3", content: "" },
	{ type: "context" as const, left: "4", right: "4", content: 'import { db } from "../database";' },
	{ type: "context" as const, left: "5", right: "5", content: "" },
	{ type: "context" as const, left: "6", right: "6", content: 'const API_KEY = "sk-live-a1b2c3d4e5f6g7h8i9j0"; // @review-target: hardcoded-key' },
	{ type: "context" as const, left: "7", right: "7", content: "" },
	{ type: "context" as const, left: "8", right: "8", content: "interface User {" },
	{ type: "context" as const, left: "14", right: "14", content: "" },
	{ type: "context" as const, left: "15", right: "15", content: "export async function getUser(userId: string): Promise<User | null> {" },
	{ type: "remove" as const, left: "16", right: "", content: '  const query = "SELECT * FROM users WHERE id = \'" + userId + "\'"; // @review-target' },
	{ type: "remove" as const, left: "17", right: "", content: "  const rows = await db.execute(query);" },
	{ type: "add" as const, left: "", right: "16", content: '  const rows = await db.execute("SELECT * FROM users WHERE id = ?", [userId]);' },
	{ type: "context" as const, left: "18", right: "17", content: "  return rows[0] ?? null;" },
	{ type: "context" as const, left: "19", right: "18", content: "}" },
	{ type: "context" as const, left: "", right: "", content: "" },
	{ type: "context" as const, left: "21", right: "20", content: "export async function updateUserBio(userId: string, bio: string): Promise<void> {" },
	{ type: "remove" as const, left: "22", right: "", content: "  await db.execute(`UPDATE users SET bio = '${bio}' WHERE id = '${userId}'`);" },
	{ type: "add" as const, left: "", right: "21", content: '  await db.execute("UPDATE users SET bio = ? WHERE id = ?", [bio, userId]);' },
	{ type: "context" as const, left: "23", right: "22", content: "}" },
] as const;

// Working changes for git panel (from screenshot 1)
export const WORKING_CHANGES = [
	{ name: ".mcp.json", staged: false, additions: 0, deletions: 0 },
] as const;

// Commits list (from screenshot 1)
export const COMMITS = [
	{ hash: "99febcb", message: "fix: Config type saf...", time: "6 hours ago", additions: 17, deletions: 14, files: 1 },
	{ hash: "93a054a", message: "fix: Order process...", time: "6 hours ago", additions: 75, deletions: 51, files: 1 },
	{ hash: "d29b93e", message: "fix: React best pra...", time: "6 hours ago", additions: 13, deletions: 14, files: 1 },
	{ hash: "e919ac3", message: "fix: Performance o...", time: "6 hours ago", additions: 13, deletions: 13, files: 1 },
	{ hash: "0307f15", message: "fix: Security harde...", time: "6 hours ago", additions: 22, deletions: 7, files: 1 },
	{ hash: "203c6c9", message: "fix: SQL injection v...", time: "6 hours ago", additions: 6, deletions: 6, files: 2 },
	{ hash: "cb16982", message: "feat: add user serv...", time: "6 hours ago", additions: 313, deletions: 0, files: 5 },
] as const;

// Branch changes (from screenshot 1)
export const BRANCH_FILES = [
	{ name: "user-service.ts", path: "src/", additions: 62 },
	{ name: "Dashboard.tsx", path: "src/", additions: 47 },
	{ name: "config.ts", path: "src/", additions: 50 },
	{ name: "order-processor.ts", path: "src/", additions: 135 },
	{ name: "data-processing.ts", path: "src/", additions: 60 },
] as const;

// File tree (from screenshot 2)
export const FILE_TREE = [
	{ name: "src", type: "dir" as const, children: [
		{ name: "api/user-service.ts", type: "file" as const },
		{ name: "components/Dashboard.tsx", type: "file" as const },
		{ name: "lib/config.ts", type: "file" as const },
		{ name: "services/order-processor.ts", type: "file" as const },
		{ name: "utils/data-processing.ts", type: "file" as const },
	]},
	{ name: "package.json", type: "file" as const },
	{ name: "tsconfig.json", type: "file" as const },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/mockup/mock-data.ts
git commit -m "feat(website): rewrite mock data to match real app screenshots"
```

---

## Task 2: Rewrite sidebar to match real app

**Files:**
- Rewrite: `src/components/mockup/sidebar.tsx`

The real sidebar shows:
- **Repos**: Project names with expandable branches (main, tset, feature/...), "✓ comments resolved" subtitle on review branches, "+ Add Repository" at bottom, Settings + terminal icons in footer
- **Tickets**: "All Tickets" with count badge, LINEAR section header, project name "SuperiorSet" with count
- **PRs**: PRs grouped by repo header ("VROLIXTHOMAS/SUPERIORSWARM-TE..."), each PR shows title, branch info, author initial circle, green/yellow status dot

- [ ] **Step 1: Rewrite sidebar.tsx**

Implementer must read the current `sidebar.tsx`, then replace its entire content with a version that matches the screenshot designs described above. Key visual elements:

- Repos: each project is a collapsible section with the project name as header, branches listed below with indentation, active branch highlighted, review branches show "✓ comments resolved" in muted green text
- Tickets sidebar: "All Tickets" row with grid icon + count badge on right, "LINEAR" section label, "SuperiorSet" with dot + count
- PRs: repo name as section header (uppercase, truncated), PR items with title, "by Author" line, green circle status indicator
- Settings gear icon + terminal icon at the bottom of the sidebar
- The segment control pills match the real app: `rounded-[5px]` not `rounded-[3px]`, active state uses `bg-bg-overlay`

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/mockup/sidebar.tsx
git commit -m "feat(website): rewrite sidebar to match real app design"
```

---

## Task 3: Rewrite terminal view to match real app

**Files:**
- Rewrite: `src/components/mockup/terminal-view.tsx`

The real terminal (screenshot 1) shows:
- Tab bar with numbered tab "1", then ">_" icon, "* Claude Code" text, "×" close button
- Terminal content: shell prompts, then Claude Code v2.1.87 welcome banner with ASCII art mascot, tips panel, recent activity
- Below terminal: "PR #1" label with blue text

- [ ] **Step 1: Rewrite terminal-view.tsx**

Replace with a component that renders the Claude Code welcome screen as seen in the screenshots. The tab bar uses a different style (numbered, with close buttons). The terminal content shows the actual Claude Code welcome banner.

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/mockup/terminal-view.tsx
git commit -m "feat(website): rewrite terminal view to match Claude Code welcome screen"
```

---

## Task 4: Rewrite ticket board view with Board/List/Table toggle

**Files:**
- Rewrite: `src/components/mockup/ticket-board-view.tsx`

The real tickets view (screenshots 5-7) shows:
- Header: "All Tickets" bold + "All providers · 3 tickets" muted + Board|List|Table toggle on right
- **Board**: Columns with circle status icons (○ BACKLOG, ◎ TODO, ◐ IN PROGRESS, ● DONE), cards with ticket key + "Linear" badge + title
- **List**: Collapsible groups with chevron, status icon + count, rows with icon + key + title + "Linear" tag
- **Table**: Column headers (ID, TITLE, STATUS↑, PROJECT, SOURCE, UPDATED), rows with status pill badges

The view toggle is local state — clicking Board/List/Table switches the display.

- [ ] **Step 1: Rewrite ticket-board-view.tsx**

Create a component with 3 sub-views and a toggle. Use the TICKETS and TICKET_STATUSES data. The board view shows proper status circle icons. The list view has collapsible groups. The table view has a proper header row with columns.

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/mockup/ticket-board-view.tsx
git commit -m "feat(website): rewrite tickets with board/list/table views matching real app"
```

---

## Task 5: Rewrite right panel with toolbar-switched views

**Files:**
- Rewrite: `src/components/mockup/review-panel.tsx`

The real right panel (screenshots 1-4, 8-10) has a **toolbar at the top** with icon buttons that switch between views:
1. **Git Changes** (≡ icon): Branch selector, WORKING CHANGES with staging/commit controls, COMMITS list, BRANCH CHANGES file tree
2. **File Tree** (folder icon): Search input, collapsible directory tree
3. **PR Comments** (speech bubble icon): "Pull Request #1 · 24 comments", threads grouped by file, each with file:line, author, date, text, Resolve/Skip buttons, Reply input. Bottom: "Solve with AI (24 comments)" button
4. **Branch Overview** (lines icon): Branch info, BRANCH CHANGES summary, COMMITS

This replaces the old review-panel.tsx which only showed review findings.

- [ ] **Step 1: Rewrite review-panel.tsx as a multi-view panel**

The component manages its own view state. The toolbar renders 4 icon buttons. Each view renders the corresponding content from mock data. The default view is "changes" (git changes). When in PRs mode, default to "comments".

Key visual elements from screenshots:
- Toolbar: small icon buttons in a row, active one highlighted
- Git changes: "WORKING CHANGES (1)" header with "Stage All", file checkbox rows, "Commit message..." textarea, "Commit" blue button + "Push ↑", "COMMITS (7)" collapsible section, "BRANCH CHANGES" section with file tree
- PR Comments: Thread cards with "user-service.ts:16" header, "Resolve" + "Skip" buttons on right, author name bold, date muted, comment text, "Reply..." input
- File tree: "Search files..." input, folder icons, file icons with color coding

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/mockup/review-panel.tsx
git commit -m "feat(website): rewrite right panel with toolbar-switched git/files/comments/overview views"
```

---

## Task 6: Rewrite comment solver to match real app

**Files:**
- Rewrite: `src/components/mockup/comment-solver-view.tsx`

The real comment solver (screenshot 4) shows:
- **Center panel becomes a diff editor**: Side-by-side with left/right line numbers, red (removed) and green (added) lines, file path + commit hash in header, "Inline" toggle
- **Right panel**: "PULL REQUEST test/ai-review-..." header, "● 24 resolved", "6 COMMIT GROUPS", each group has label + (n/n) count + "Approve"/"Follow up" buttons, commit hashes, nested comment threads. Bottom: "Push changes & post replies" green button + "Revert all"

The mockup-shell needs to know when the solver is active so the center panel switches from terminal to diff view.

- [ ] **Step 1: Create a diff-view.tsx for the center panel**

Create `src/components/mockup/diff-view.tsx` that renders the side-by-side diff using DIFF_LINES data. Shows file tab at top ("user-service.ts (fix) ×"), file path bar ("src/api/user-service.ts", commit hash, "Inline" toggle), then the two-column diff with line numbers.

- [ ] **Step 2: Rewrite comment-solver-view.tsx for the right panel**

Shows the commit groups with approve/follow-up, nested comment threads, and push/revert bar at the bottom. Matches screenshot 4's right panel.

- [ ] **Step 3: Commit**

```bash
git add apps/website/src/components/mockup/diff-view.tsx apps/website/src/components/mockup/comment-solver-view.tsx
git commit -m "feat(website): rewrite comment solver with diff editor and commit groups"
```

---

## Task 7: Update mockup-shell for new interactions

**Files:**
- Modify: `src/components/mockup/mockup-shell.tsx`

Updates needed:
- Add `solverActive` state that swaps center panel from terminal to diff-view when comment solver is triggered
- Right panel toolbar integration: pass the current segment to review-panel so it knows which default view to show
- Tab bar at the top of center panel: show real tab style (numbered, with icons and close buttons) instead of the current simplified tabs
- When "Solve with AI" is clicked in PR comments → switch to solver mode (center = diff, right = commit groups)
- Adjust panel widths slightly if needed

- [ ] **Step 1: Update mockup-shell.tsx**

Add `solverActive` boolean state. When solver activates, center panel renders `DiffView` instead of `TerminalView`. Import the new `DiffView`. Update the right panel to always render `ReviewPanel` (which handles its own view switching internally). Pass relevant props.

- [ ] **Step 2: Commit**

```bash
git add apps/website/src/components/mockup/mockup-shell.tsx
git commit -m "feat(website): update shell for solver mode and right panel toolbar"
```

---

## Task 8: Build verification and polish

**Files:**
- All mockup files

- [ ] **Step 1: Run type-check and lint**

```bash
cd apps/website && bun run type-check && bun run lint
```

Fix any errors.

- [ ] **Step 2: Run production build**

```bash
cd apps/website && bun run build
```

- [ ] **Step 3: Visual review checklist**

- [ ] Repos sidebar: projects with expandable branches, "✓ comments resolved"
- [ ] Tickets sidebar: "All Tickets" + LINEAR section + project name
- [ ] PRs sidebar: grouped by repo, PR items with author + status
- [ ] Terminal: Claude Code welcome banner, proper tab style
- [ ] Tickets center: Board/List/Table toggle, proper status icons
- [ ] Right panel toolbar: 4 icon buttons switching views
- [ ] Git changes view: working changes, commits, branch changes
- [ ] PR comments view: threads by file, resolve/skip, "Solve with AI"
- [ ] File tree view: directory structure
- [ ] Comment solver: diff editor in center, commit groups in right panel
- [ ] Mobile: stacked layout still works

- [ ] **Step 4: Final commit**

```bash
git add -A apps/website/src/
git commit -m "chore(website): polish mockup overhaul"
```
