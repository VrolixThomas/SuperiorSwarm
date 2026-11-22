# Queue merge verification

`activity-queue` fast-forwarded from `014e5e79` to reviewed integration `84edb72c` at the user's request. No newly tracked path overwrote differing local content. The user's `bun.lock` remains modified exactly as before, SHA256 `c3b29706e35ce3b2abe14db228dcc11f8917d97a6ae4eaca5a0d8eb29dca10ad`.

Post-merge desktop build passes. Six isolated smoke suites pass (38 tests), covering unified source receipts, ticket Start, guarded publication, publication UI, hook dispatch admission and project Open targeting. No push/release.

Additional user-requested combined QA is in progress with three separate Codex agents: mixed-source native UI, cross-source lifecycle/cleanup, and publication/navigation interactions. They use isolated test state and fake external providers; no live tickets, PRs, hooks or existing chats are mutated. Their final evidence will be recorded here; this paragraph is not a claim that those additional checks have completed.
