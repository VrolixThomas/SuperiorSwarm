# Reply recipient context correction

Production commit **82197f07**, based on staging `b0208c14`. Only `QueueQuestionReply.tsx` changes production behavior; no backend edits or additional agents.

Default recipient text now uses project/workspace (or the coordinator's own name), provider and distinct chat title. Equal project/workspace/chat names are deduplicated. Workspace/coordinator ID, terminal ID, provider conversation ID and question ID remain available inside **collapsed Technical details**. Exact reply mutation arguments are unchanged.

Question/reply/evidence remain plain text with preserved line breaks and indentation; multiline delivery errors also preserve whitespace. Saved, not-yet-read and not-automatically-resumed wording remains explicit.

## Verification

- **Focused rendered tests:** 26 passed, 121 assertions. New tests cover readable/deduplicated workspace and coordinator recipients, raw IDs contained in closed details, unchanged exact submission arguments, multiline saved replies, multiline delivery errors and literal multiline question/reply/command-error evidence. [focused.txt](focused.txt). The new recipient tests failed before implementation: [recipient-before.txt](recipient-before.txt).
- **Fresh desktop build:** passed. [build.txt](build.txt).
- **Affected native screenshot test:** passed in 8.90 seconds using the investigator's test-only startup activation (`app.focus({steal:true})` and `contents.focus()`). [native-activated.txt](native-activated.txt). The native checks assert raw IDs are absent from visible `innerText` while Technical details is closed, become available when expanded, the human recipient is not duplicated, and question/saved-answer paragraphs preserve newlines with computed `white-space: pre-wrap`.
- **Important harness distinction:** the unmodified native harness failed early at `Queue keyboard focus invisible`, both before GUI coordination and in an exclusive serial slot. These are retained failures, not passing product checks: [initial failure](native-initial-focus-failure.txt), [serial failure](native-serial-focus-failure.txt). The temporary [activation patch](temporary-test-activation.patch) was coordinated with the independent investigator, used only for native verification, then restored. Their separate harness change owns this correction; this narrow production commit does not silently weaken or skip focus assertions.

Visually inspected [saved answer](queue-question-saved.png) and [stale question/draft](queue-question-conflict.png). Both show readable recipient context, collapsed technical IDs and multiline text. The saved screenshot explicitly says the agent has not read the answer and saving does not resume the task.

The GUI slot was released to the investigator immediately after the native run. Existing artifacts are unchanged. Logs here only normalize trailing whitespace. Compatible parent dependency links were removed after testing; no lockfile, shared DB policy, installed/dev app, global permission/trust setting, push or release was changed. The known missing graphify module was reported by the normal commit hook and was not installed.
