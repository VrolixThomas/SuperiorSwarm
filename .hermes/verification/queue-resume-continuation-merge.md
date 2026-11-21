# Queue resume and answer continuation merge

The continuation of SUP-45 implements structured same-conversation resume, explicit Save & continue, and typed personal Claude/Codex chat creation across workspace/folder/coordinator panes. Existing bare terminals and arbitrary Quick Actions remain available; unknown launch provenance keeps Open/manual recovery rather than guessed policy.

Integrated lanes: structured daemon lifecycle/admission, exact saved-answer transport/UI, and app-owned chat launch. Original user bun.lock remains untouched.

## Verification

- Parent final targeted integration:79 tests/625 assertions across9 files pass, including native environment capture, process lifecycle/admission, public answer routes, own-chat launch/duplicate-create, UI, and launch callback provenance.
- Main/daemon build with rebuilt native environment helper passes.
- Real interactive Claude and Codex each passed repeated sleep/resume/reply cycles in the same conversation. Codex promptless resume defers SessionStart until first input; verification checks native process/transcript, unchanged queue receipt, then a manual follow-up.
- Real saved-answer probes passed for live Claude and sleeping Codex through the actual Queue UI/public router. Question records were controlled seeds bound to the real conversation; actual provider acceptance, new reply, digest retrieval and duplicate prevention were verified. This does not claim real MCP question creation in those probes.
- Author native UI checks cover primary Send & continue, Save-only, exact retrieval and sibling isolation with controlled transport. Own-chat menus are tested in native workspace/folder/coordinator layouts with zero launch effects from viewing the menu.
- Final provider-exec environment preservation is guarded by same-UID/process identity capture and kept only in daemon memory. Protected/empty/unreadable environments reject registration; no secrets enter public IPC, callbacks or database.

## Explicit limits

Unknown/legacy launch settings, unsupported native identity/environment capture, competing pending questions or valid answers, and oversized answer envelopes retain clear Open/Save-only fallback. New typed chat actions supply verifiable launch provenance without taking over an orchestrator's dispatch target. No arbitrary shell commands are reconstructed into trusted resume descriptors.

See the lane reports in queue-safe-resume-2026-11-22, queue-answer-continuation-2026-11-22 and queue-owned-chat-launch-2026-11-22 for source checks and fixture boundaries. Actual-provider logs are retained with the parent continuation evidence.

## Post-environment live probes still open

The final guarded implementation was merged at the user's explicit request. The79-test final targeted suite and rebuilt main/daemon/native helper passed. Earlier real-provider resume/answer successes establish those transport mechanics, but are not counted as final environment-registration proof: the additional empty Codex startup probe stopped at its synthetic hook-review gate before firstturn; the final Claude automatic-registration probe timed out before hibernation. Neither probe sent an unsafe resume or bypassed verification. SUP-45 remains in progress for this last live registration follow-up. Logs are under queue-resume-continuation-2026-11-22.
