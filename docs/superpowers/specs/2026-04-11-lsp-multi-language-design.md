# Multi-Language LSP Support Design

Date: 2026-04-11  
Status: Proposed

## Goal

Support LSP-powered editor features (completion, hover, go-to-definition, find references, diagnostics) for any language with an installed language server, not only JavaScript/TypeScript.

## Context

Current behavior is limited by a renderer-side allowlist in `apps/desktop/src/renderer/components/FileEditor.tsx`:

- `supportedLspLanguages = ["typescript", "javascript", "python"]`

The main process already has a generic stdio server manager and IPC pipeline (`apps/desktop/src/main/lsp/server-manager.ts`, `apps/desktop/src/main/lsp/ipc-handler.ts`), but renderer gating prevents broader enablement.

## Non-Goals

- Bundling every language server binary with the app.
- Implementing custom non-LSP adapters per language.
- Blocking file open or typing while servers start.

## Design Overview

Adopt a layered dynamic registry:

1. Keep one generic LSP engine (spawn/init/request/notification/restart).
2. Move language support definitions into merged configuration data.
3. Dynamically enable LSP in renderer based on runtime support checks.
4. Preserve graceful fallback to plain Monaco when a server is unavailable.

This model scales to long-tail language support without shipping app updates for each new language.

## Architecture

### 1) Language Server Registry

Introduce a registry in main process that resolves language support from three sources, highest precedence last:

1. Built-in defaults (curated popular servers).
2. User config (machine-level).
3. Repo config (project-level).

Merged result is a map keyed by server id with language/extension indexes.

Proposed entry shape:

```json
{
  "id": "rust-analyzer",
  "languages": ["rust"],
  "fileExtensions": [".rs"],
  "command": "rust-analyzer",
  "args": [],
  "rootMarkers": ["Cargo.toml", ".git"],
  "initializationOptions": {},
  "disabled": false
}
```

### 2) Main Process LSP Services

Keep `ServerManager` generic and repo-scoped per server:

- key: `(serverId, repoPath)`
- lifecycle: spawn -> initialize -> serve requests/notifications -> diagnostics stream -> shutdown/restart
- crash policy: bounded retries with backoff (existing pattern retained)

Add a support-resolution API that answers:

- is language supported for this file/repo?
- which server config applies?
- is the executable currently available?

### 3) Renderer Integration

Remove hardcoded language allowlist in `FileEditor`.

On model load:

1. Renderer asks main via IPC `lsp:getSupport` with `{ repoPath, languageId, filePath }`.
2. If supported, renderer registers providers and sends `didOpen`.
3. On edits, send `didChange` with incremental version.
4. On close/unmount, send `didClose`.

Provider registration remains language-based, but enablement becomes dynamic per resolved support.

### 4) Config Files

Proposed paths:

- User: `~/.config/superiorswarm/lsp.json`
- Repo: `.superiorswarm/lsp.json`

Rules:

- Repo overrides user overrides built-in.
- Invalid entries are ignored with warnings (never crash app startup).
- `${workspaceFolder}` and `${env:VAR}` expansion supported for command/args fields.

## Runtime Flow

1. User opens file.
2. Renderer determines Monaco `languageId` and file extension.
3. Renderer requests support from main.
4. Main resolves config and checks command availability (cached).
5. If supported: renderer enables LSP pipeline (`didOpen`/`didChange`/`didClose`, provider-backed requests).
6. Diagnostics notifications are forwarded and rendered as Monaco markers.
7. If server crashes: main restarts and notifies renderer to replay `didOpen` for tracked documents.

## Error Handling and UX

- Missing binary (`ENOENT`): mark server unavailable, return structured reason, show non-blocking editor banner.
- Request timeout: return error to provider call; provider degrades gracefully (no hard failure).
- Unsupported language: keep editor fully usable, disable only LSP-powered features.
- Repeated crash beyond threshold: stop retrying, expose state in diagnostics/health UI.

Add an "LSP Health" section in settings with:

- configured servers
- installed/missing status
- last startup error
- active sessions
- install hint text

## Security and Safety

- Only execute configured commands as child processes in repo cwd.
- Keep IPC payload cloneability checks for request responses.
- Treat config as data; validate schema strictly before use.

## Testing Strategy

### Unit

- Registry merge precedence (built-in < user < repo).
- Resolver behavior by language id and extension fallback.
- Variable expansion correctness.
- Schema validation and bad-entry rejection.

### Integration

- Supported language path enables providers and document sync.
- Missing server command yields graceful unavailable state.
- Crash/restart causes `didOpen` replay and recovery.
- Unsupported language keeps editor functional without LSP actions.

## Rollout Plan

1. Add registry + support-resolution IPC while preserving current TS/JS/Python behavior.
2. Remove renderer hardcoded allowlist and switch to dynamic support checks.
3. Add user/repo config loading and validation.
4. Add LSP Health UI and install guidance.
5. Expand built-in default catalog iteratively.

## Alternatives Considered

### A) Keep expanding hardcoded arrays

Pros: fastest short-term.  
Cons: unscalable, frequent app updates, misses custom environments.

### B) Per-language adapters/plugins

Pros: maximal language-specific tuning.  
Cons: high maintenance and complexity for standard LSP use cases.

### C) Dynamic registry (chosen)

Pros: scalable, user/repo flexible, minimal core complexity increase.  
Cons: requires good config UX and validation.

## Locked Decisions

- Initial built-in catalog: TypeScript/JavaScript (`typescript-language-server`), Python (`pyright-langserver`), Go (`gopls`), Rust (`rust-analyzer`), Java (`jdtls`), C/C++ (`clangd`), PHP (`intelephense --stdio`), Ruby (`solargraph stdio`), JSON/CSS/HTML (Monaco built-ins remain available regardless of external LSP).
- Repo config discovery scope: repository root only (`<repo>/.superiorswarm/lsp.json`), no parent-directory walk.
- Health panel milestone: phase 4, after dynamic registry and config loading are stable.

## Success Criteria

- A language not hardcoded in source can be enabled by config alone.
- Go-to-definition/references/hover/diagnostics work for any configured+installed server.
- Missing or misconfigured servers degrade gracefully without impacting core editing.
- Existing JS/TS flow remains stable.
