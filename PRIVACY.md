# Privacy notice

SuperiorSwarm is a desktop application that runs entirely on your machine. Two pieces of data leave your device, both described below.

## 1. Account data (required to sign in)

To sign in you use GitHub or Apple OAuth. Our Supabase project stores the standard OAuth profile fields those providers return: your email address, display name, avatar URL, provider user ID, and the access token Supabase uses to keep your session valid. This is the minimum needed to authenticate you and is managed by Supabase Auth.

## 2. Usage telemetry (on by default, toggleable)

Once per day (and once immediately after you first sign in), the app sends a single snapshot row tied to your Supabase account ID. It contains:

- **Environment:** app version, OS platform (darwin / win32 / linux), CPU arch, locale.
- **Lifecycle:** when you first launched the app, when you first signed in, when this snapshot was sent.
- **Integrations:** booleans indicating whether GitHub, Linear, Jira, or Bitbucket is connected (never any tokens or account identifiers).
- **Feature usage:** booleans for whether you've ever used AI review and comment solver.
- **Cumulative counters:** total number of terminal sessions started, reviews started, and comments solved over the lifetime of the install.
- **Auth provider:** which OAuth provider you signed in with (github / apple).

### What the telemetry snapshot never includes

- Repository contents, file paths, file names, or file hashes
- Branch names, commit messages, commit SHAs, diffs
- Pull request titles, descriptions, comments, or reviews
- Ticket titles, descriptions, or any Linear/Jira content
- Prompts you send to Claude or any other agent
- Agent responses or terminal output
- Access tokens or any credential material

### How to opt out

Toggle it off anytime under **Preferences → Usage analytics**. When off, no further snapshots are sent.

## Questions

Open an issue at https://github.com/VrolixThomas/SuperiorSwarm.
