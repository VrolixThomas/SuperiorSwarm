# Privacy notice

SuperiorSwarm is a desktop application that runs entirely on your machine. This notice describes the one piece of telemetry the app sends to our servers, so you can decide whether to allow it.

## What we collect

Once per day (and once immediately after you first sign in, if you opt in), the app sends a single snapshot row tied to your Supabase account ID. It contains:

- **Environment:** app version, OS platform (darwin / win32 / linux), CPU arch, locale.
- **Lifecycle:** when you first launched the app, when you first signed in, when this snapshot was sent.
- **Inventory counts:** how many projects, workspaces, worktrees, terminal sessions, tracked PRs, review drafts, quick actions, and extension paths you currently have.
- **Integrations:** booleans indicating whether GitHub, Linear, or Atlassian is connected (never any tokens or account identifiers).
- **Feature usage:** booleans for whether you've ever used AI review and comment solver.
- **Cumulative counters:** total number of terminal sessions started, reviews started, and comments solved over the lifetime of the install.
- **Auth provider:** which OAuth provider you signed in with (github / google / apple).

## What we never collect

- Repository contents, file paths, file names, or file hashes
- Branch names, commit messages, commit SHAs, diffs
- Pull request titles, descriptions, comments, or reviews
- Ticket titles, descriptions, or any Linear/Jira content
- Prompts you send to Claude or any other agent
- Agent responses or terminal output
- Your email address, name, avatar, or any OAuth profile field
- Access tokens or any credential material
- Any identifier beyond the Supabase user UUID

## How to opt out

During first sign-in, you can decline telemetry. You can also toggle it at any time under **Preferences → Usage analytics**. When off, no further data is sent and no snapshot is written.

## Questions

Open an issue at https://github.com/VrolixThomas/SuperiorSwarm.
