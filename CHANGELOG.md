# Changelog

## v0.4.8 (2026-04-13)

### What's New

This release delivers a major redesign of the PR comment solver in SuperiorSwarm. You can now review and push fixes per commit group, see solve status badges on individual comments, browse session history, cancel in-progress solves with partial recovery, and open the terminal side-by-side with the solve review. The update checker has been fixed to always show the latest "What's New" content, and terminal daemon stability has been improved.

### Changes

- **SUP-25**: Sup 25/update checker whats new shows stale content and p (#75)
- Terminal stability hardening (#74)
- Pr comment solver redesign v2 (#73)

## v0.4.7 (2026-04-12)

### What's New

SuperiorSwarm now supports adding entire directories to the Shared Files panel. You can pick a folder using the new folder picker, and the app will automatically detect whether an entry is a file or directory. Shared folders are tracked alongside individual files, making it easier to share entire project directories with your agents.

### Changes

- feat: shared files directory support (#72)
- Feat/shared files directory support (#71)

## v0.4.6 (2026-04-10)

### What's New

SuperiorSwarm's pull request panel has been redesigned for a cleaner, more focused experience. The What's New modal no longer shows empty release notes on first launch. Markdown file rendering, git push upstream tracking, and auto-update reliability have all been improved.

### Changes

- **SUP-13**: Fix WhatsNew modal showing empty release notes on first launch (#70)
- Always set --set-upstream (#69)
- Fix md file rendering (#68)
- Feat/claude md lean index (#67)
- Auto update fix (#66)
- Redesign PR panel (#65)

## v0.4.5 (2026-04-09)

### What's New

This release fixes a build issue that prevented MCP agent integration from working. SuperiorSwarm's AI agent features should now launch reliably after a clean build or update.

### Changes

- Mcp not working (#62)
- fix: inline Electron runtime config in agent-setup (#64)

## v0.4.4 (2026-04-08)

### What's New

SuperiorSwarm no longer freezes on startup for users with many pull requests, and the project sidebar no longer enters a reload loop while a clone is in progress. Pull request tracking now persists across restarts, so reopening the app will no longer flood you with duplicate "new PR" notifications for PRs you've already seen. Pagination against Bitbucket and GitHub is more reliable, and listing commits ahead of a branch is significantly faster on repositories with large diffs.

### Changes

- Bug app freeze (#61)

## v0.4.3 (2026-04-07)

### What's New

SuperiorSwarm now writes diagnostic logs to standard system locations and detects unsafe internal data before it can crash the app, so background failures degrade gracefully instead of taking the window down. If a crash does still occur, new breadcrumbs in the log make it much easier to identify what was happening at the moment of failure.

### Changes

- feat(main): instrument IPC paths with electron-log + clone-safety walker (#60)

## v0.4.2 (2026-04-07)

### What's New

Fixed an issue where PR review branches were not handled correctly, and resolved Bitbucket display names showing incorrectly in comments.

### Changes

- Pr review branches fix (#59)
- fix bitbucket display name (#58)

## v0.4.1 (2026-04-06)

### What's New

SuperiorSwarm's integration layer has been rebuilt around a unified provider interface, making it easier to support additional Git hosting and issue tracking platforms. Bitbucket now supports PR enrichment data in the sidebar, review verdicts (approve/request changes), and paginated diffs. A new comment events system enables automatic solving triggered by PR comments.

### Changes

- Refactor/provider interfaces (#57)

## v0.4.0 (2026-04-06)

### What's New

SuperiorSwarm now supports Sign in with Apple for quick authentication. A new indicator clearly shows when you're not logged in, making it easier to know when authentication is needed. The command palette has been enhanced with Linear-style commands for faster navigation. Several fixes improve repo overview panel behavior, the PR review flow for new users, and app window dragging.

### Changes

- Fix app dragging (#56)
- Not logged in indication (#55)
- Investigate new user with existing PR flow (#54)
- Linear style commands (#53)
- Fix repo overview closing (#52)
- Sign in with Apple (#51)

## v0.3.0 (2026-04-05)

### What's New

SuperiorSwarm now features a command palette with keyboard shortcuts for quick navigation and actions. A new quick actions bar lets you run common tasks like build, test, and lint with a single click, with optional agent-assisted setup. The settings page has been redesigned as a full-page layout with integrations and AI review configuration. Several fixes improve workspace removal, push button visibility after commits, and terminal session cleanup.

### Changes

- **SUP-7**: Add quick action buttons for common tasks like run, build, and test (#49)
- feat: add command palette and keyboard shortcuts system (#50)
- Fix push not visible after commit (#48)
- Fix removing workspace (#47)
- Fix settings page (#46)

## v0.2.3 (2026-04-05)

### What's New

The Changes tab now appears above Commits in the branch view for a more natural workflow. Minor UI cleanup removing a stray blue line.

### Changes

- **SUP-11**: switch order of changes tab and remove blue line (#45)

## v0.2.2 (2026-04-04)

### What's New

Fixed auto-updates not working in packaged builds. The updater module was excluded from the app bundle, causing "Check for updates" to silently fail.

### Changes

- fix: bundle electron-updater instead of dynamic import

## v0.2.1 (2026-04-04)

### What's New

Auto-update error messages are now visible in the About section instead of being silently swallowed. This helps diagnose update issues.

### Changes

- fix: surface auto-updater errors in UI and use direct version comparison

## v0.2.0 (2026-04-04)

### What's New

SuperiorSwarm now includes a full-featured branch manager with a command palette for checkout, merge, rebase, and branch creation — complete with a three-way merge conflict resolver. You can also paste images directly into agent chats, and the app ships with a downloads page powered by GitHub Releases. Several stability fixes improve terminal multiline input, loading screens, and default branch handling.

### Changes

- Git operations UI (#44)
- Add images to agentchats (#43)
- Update summary (#42)
- Add download page (#41)
- Fix base branch (#40)
- allow multiline typing (#39)
- Fix loading screen and app running (#38)
