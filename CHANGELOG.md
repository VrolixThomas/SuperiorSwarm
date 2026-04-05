# Changelog

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
