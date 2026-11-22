# Native external queue launch verification

Test-only harness: `tests/queue-external-launch-native.test.ts` and `tests/fixtures/queue-external-launch-native/`. Base production includes the reviewed ticket/hook/PR fixes, exact fresh review-body solver input (`99f67e18`) and inline anchors (`1ba8fb6c`).

| Actual CLI | Hook Fix | PR Solve |
| --- | --- | --- |
| Codex | Pass, 10.06s | Pass, 8.22s |
| Claude | Pass, 3.06s | Pass, 2.78s |

Each probe calls the actual main action with isolated SQLite project/workspace/source state, uses the actual confirmation bridge with an explicitly synthetic affirmative renderer response, then runs the production `openOwnedChat` helper through production preload/terminal IPC, a real daemon socket and real PTY. The generated launch script and its arguments, prompt and cwd are unchanged. Tests assert create-before-write order; accepted real UserPromptSubmit for the intended provider/terminal/canonical cwd; a fresh provider conversation; unchanged sibling managed target, conversation and process; no source acknowledgment from launch; and rejection of a second action after explicit Done without creating another terminal. Hook cases additionally verify the authentic per-command nonce and unmanaged session.

PR input uses a complete fake GitHub response for a top-level CHANGES_REQUESTED review with no issue/inline comments. The real fresh-feedback adapter and solver store exact review identity and actor context. No real GitHub/Bitbucket request is made. The native provider startup is real, not a fake CLI or mocked PTY.

## Explicit seams and limits

- The action functions are invoked directly from fixture main, not by clicking Queue's public action button. Production confirmation, renderer launch helper and terminal IPC are real. Public route/component behavior has separate source/UI/native integration coverage.
- Temporary PATH adapters exec the installed CLIs with extra restrictive test configuration: Claude tools disabled, plan mode, isolated settings and no MCP servers; Codex isolated home, read-only/on-request, exact reviewed synthetic hook hashes and no MCP servers. They preserve every original production argument. Authentication is reused without reading/copying credentials into artifacts; the temporary Codex auth symlink is removed by both child and parent cleanup.
- The first startup snapshot used adapter-supplied `--no-daemon` for the legacy PR solver. The follow-up below closes that isolation boundary; the adapter now rejects missing production isolation instead of supplying it.
- Physical hook config reads are redirected by a test-only Vite transform to synthetic fixture bytes, while the production canonical root/hash/trust/action checks remain in place. No hook command is run and no config is written in the user's trusted Claude checkout. The real config-reader/runner is covered separately by hook suites and combined native tests.
- These are startup/callback tests, not completed MCP-powered solving, code editing, commits, external publishing, or a full repo/folder/orchestrator Cartesian matrix. Claude's tool-free configuration intentionally cannot read the generated solver prompt file or call solve MCP tools. Exact input preparation is asserted in SQLite separately. Both-provider scope variations are covered by the hook launch unit matrix.
- The PR solver retains its existing bash script leader with the real native CLI in the foreground group. Tests use production foreground-group inspection. This does not grant structured inline resume provenance; legacy solvers retain manual Open fallback. Hook launches have a direct native executable leader.

All four final probes remove their temporary credential link. Global provider config/trust, existing app instances and user files are unchanged. Type checking has existing repository diagnostics but none in new harness files. Biome passes with existing-style non-null assertion warnings. Initial fixture setup caught the macOS Unix socket path-length limit and a too-strict provider-leader assertion for the legacy solver; neither required a production guard change.

## Reproduce

From `apps/desktop`, after building, with exclusive GUI ownership:

```sh
SS_QUEUE_EXTERNAL_LAUNCH_NATIVE=1 SS_QUEUE_LAUNCH_KIND=hook SS_QUEUE_NATIVE_CASES=codex bun test tests/queue-external-launch-native.test.ts
SS_QUEUE_EXTERNAL_LAUNCH_NATIVE=1 SS_QUEUE_LAUNCH_KIND=pr SS_QUEUE_NATIVE_CASES=codex bun test tests/queue-external-launch-native.test.ts
```

For Claude set `SS_QUEUE_NATIVE_CASES=claude` and `SS_QUEUE_TRUSTED_CWD` to an already-trusted checkout. The fixture uses no approval/hook-trust bypass flags. Do not run GUI fixtures concurrently.

## Production Codex solver isolation follow-up

`queueSolve` now adds exactly one `--no-daemon` for Codex, matching app-owned chat behavior. Solver launches carry a per-session task token and terminal callback environment; they must not reuse another session's shared daemon environment. Permission flags, prompt, cwd, task registration and existing shell/PID lifecycle remain unchanged. Claude command generation is unchanged.

The new regression executes the real generated script against an argv-capturing executable in a temporary repository. Before the patch both Codex permission configurations failed and both Claude cases passed. Afterward all four pass, alongside 46 existing solver tests (**50 pass / 113 assertions**). This is argv proof, not actual privilege-changing execution.

The actual Codex PR native probe passes again in **9.14s**, with the adapter no longer adding `--no-daemon`. It explicitly requires the flag in the unchanged production script and rejects its absence. Exact callback/cwd/conversation/sibling/source/Done checks remain enabled. The provider home stays isolated and no shared user daemon is touched.
