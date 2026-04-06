# Changelog

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
