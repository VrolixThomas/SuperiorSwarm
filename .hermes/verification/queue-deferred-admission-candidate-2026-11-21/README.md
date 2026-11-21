# Deferred-only admission comparison candidate

Candidate: `3ee0e26786ff537e18e1cee7375423f16ba5413d`, based on `1ade548b` (includes `8571db81`). Codex, sole agent; no subagents or live provider probes.

The only production delta is in `control-plane/server.ts`: context resolution returns the original first-generation lease immediately instead of awaiting its registration. Existing asynchronous post-connect admission and the first-tool gate are unchanged. Immutable first capture, replacement/closure rejection, expiry, identity and current-owner checks remain unchanged. No global settings, shared DB policy, app lifecycle, permissions or lockfiles changed.

A new controlled assertion verifies MCP initialize and `tools/list` expose `set_status` before any provider registration. It failed against the waiting version (over 5 seconds), then passed on this candidate (about 141ms for both synthetic provider shapes). The full controlled run passed **6 tests / 41 assertions**, including first-tool admission, exact identity, continuation, immutable replacement rejection and lease expiry checks. Biome passed. Artifacts here preserve both red and green results.

These are real MCP subprocess/control-plane tests with injected provider event ordering, not authenticated CLI or native first-turn proof. Parent and investigator received the candidate for catalog/UserPromptSubmit/first-action red/green comparison. **Do not treat the product regression as fixed or approve integration until that actual case passes.**
