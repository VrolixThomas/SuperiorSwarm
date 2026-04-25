# Changelog

## v0.6.1 (2026-04-25)

### What's New

SuperiorSwarm v0.6.1 makes PR review fully keyboard-driven. Step through review threads across files without leaving the keyboard, the active thread is highlighted, and the PR overview tab now reuses a single tab instead of opening duplicates. Terminal sessions also focus the cursor on mount so you can type immediately.

### Changes

- feat(pr-review): keyboard-driven PR review with single-tab swap (#97)
- fix(terminal): focus xterm on mount so cursor is ready (#96)

## v0.6.0 (2026-04-25)

### What's New

SuperiorSwarm v0.6.0 introduces full light and dark theme support. Switch themes from the new Appearance section in Settings or via the command palette. The Monaco editor now follows your chosen theme, all contrast ratios meet accessibility standards across both modes, and the theme persists across restarts. This release also fixes review display order and markdown file handling.

### Changes

- fix review (#94)
- Fix contrast (#95)

## v0.5.2 (2026-04-20)

### What's New

SuperiorSwarm v0.5.2 revamps the tickets page with assignee support — view assignee avatars, reassign tickets with a picker, filter by assignee, and control which teams are visible. External links now open in your default browser instead of a cramped Electron popup. Includes a fix for shared files that prevents a rare self-symlink loop.

### Changes

- **SUP-34**: Open external links in OS browser instead of Electron popup (#91)
- **SUP-24**: Tickets page v3 — assignee avatars, picker, filter, team visibility (#92)
- fix(shared-files): guard against self-symlink when source equals target (#93)

## v0.5.1 (2026-04-20)

### What's New

SuperiorSwarm v0.5.1 introduces a redesigned Review tab for stepping through changes with keyboard shortcuts (j/k to move, e to edit, v to toggle viewed), filter tabs, sidebar ordering, and a split/unified diff toggle. Files can be edited inline with Monaco and are auto-marked as viewed when you advance. The website also gains a privacy policy, terms of service, and a GDPR data subject rights page, with refined home page copy.

### Changes

- **SUP-17**: Add legal compliance — privacy policy, ToS, and GDPR readiness (#88)
- **SUP-33**: Improve review process (v2) (#89)
- fix(website): remove em dashes from home page copy (#90)

## v0.5.0 (2026-04-18)

### What's New

SuperiorSwarm v0.5.0 expands language server support beyond the built-in servers — you can now configure additional language servers from the Settings page, with presets for popular languages, repo-level trust controls, and improved PATH resolution for toolchains. This release also introduces opt-in usage telemetry: an anonymous snapshot of aggregate activity metrics sent on sign-in to help improve the app. A first-run prompt lets you opt in or out, and the toggle is always available in Preferences.

### Changes

- **SUP-23**: Add multi-language LSP support with settings UI, dynamic server registry, and repo trust (#87)
- **SUP-31**: Add usage telemetry snapshots to Supabase (#86)

## v0.4.13 (2026-04-15)

### What's New

SuperiorSwarm now includes a default shortcut for quick actions, giving you immediate access to common tasks. Commit updates are also faster and more responsive than before.

### Changes

- faster updating commits (#85)
- Add default shortcut (#84)

## v0.4.12 (2026-04-14)

### What's New

Fixed an issue where commits weren't displaying their associated files in the commit details view.

### Changes

- Commits not showing files (#83)

## v0.4.11 (2026-04-14)

### What's New

Notification sounds now play correctly in production builds. A path resolution issue caused sounds to silently fail when the app was packaged — this is now fixed.

### Changes

- fix: use relative path for notification sound in production (#82)

## v0.4.10 (2026-04-13)

### What's New

Download links are now available on the homepage. Bug fixes for merge and rebase operations, and improved listener isolation for development environments.

### Changes

- Website homepage download (#81)
- fix: prevent dev instances from killing prod agent-notify listener (#80)
- Rebase and merge not working (#79)

## v0.4.9 (2026-04-13)

### What's New

This release includes major UI/UX improvements and bug fixes across the entire app. The PR review interface has been completely redesigned for better usability, agent notification sounds now work reliably, and overall stability has been improved. Users will also benefit from better terminal handling, improved update notifications, and a redesigned PR comment solver with per-commit review capabilities.

### Changes

- **SUP-26**: Sup 26/agent notification sounds never play due to eaddri (#77)
- Pr reviewer redesign (#76)
- **SUP-25**: Sup 25/update checker whats new shows stale content and p (#75)
- Terminal stability hardening (#74)
- Pr comment solver redesign v2 (#73)
- feat: shared files directory support (#72)
- Feat/shared files directory support (#71)
- **SUP-13**: Sup 13/whatsnewmodal shows empty release notes on first c (#70)
- always set --set-upstream (#69)
- Fix md file rendering (#68)
- Feat/claude md lean index (#67)
- Auto update fix (#66)
- Redesign pr panel (#65)
- fix: inline Electron runtime config in agent-setup (#64)
- Mcp not working (#62)
- Bug app freeze (#61)
- feat(main): instrument IPC paths with electron-log + clone-safety walker (#60)
- Pr review branches fix (#59)
- fix bitbucket display name (#58)
- Refactor/provider interfaces (#57)
- Fix app dragging (#56)
- Not logged in indication (#55)
- Investigate new user with exising pr flow (#54)
- Linear style commands (#53)
- Fix repo overview closing (#52)
- Sign in with apple (#51)
- feat: add command palette and keyboard shortcuts system (#50)
- **SUP-7**: Sup 7/add buttons for common things such as run buildtes (#49)
- Fix push not visable after commit (#48)
- Fix removing workspace (#47)
- fix settings page (#46)
- **SUP-11**: switch order of changes tab and remove blue line (#45)
- Git operations UI (#44)
- Add images to agentchats (#43)
- Update summary (#42)
- Add download page (#41)
- Fix base branch (#40)
- allow multiline typing (#39)
- Fix loading screen and app running (#38)
- Fix CI OOM for renderer build (#37)
- update summary (#36)
- fix(website): use overflow-x clip instead of hidden to fix mobile scr… (#35)
- readme (#34)
- Website (#33)
- fix(website): remove static export to enable Vercel Analytics script … (#32)
- added license (#31)
- feat: SuperiorSwarm marketing website (#30)
- supabase auth (#29)
- make pr section similar to rep (#28)
- fetch remote branches as well (#27)
- feat(tickets): drag-and-drop status changes across views (#26)
- rebrand (#25)
- Agent notifications v2 (#24)
- Add logo (#23)
- cleanup ui (#22)
- Fix tickets (#21)
- Ai comments solver (#20)
- Vim addition (#18)
- feat(ai-review): add AI review backend with MCP server and orchestrator (#17)

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
