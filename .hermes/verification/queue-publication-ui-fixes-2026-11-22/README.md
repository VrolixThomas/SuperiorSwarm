# Publication UI independent-review fixes

Base `24862e22` (`d8cba5bd` publication implementation). This lane fixes the two independently reproduced UI defects; backend publication remediation is a separate lane.

- Queue origins are retained per workspace/provider/PR review session, so ordinary navigation/restoration does not silently choose immediate publication. Exact bindings and summary/reply drafts are included in the existing session snapshot and restored before opening the review. Explicit review close removes that binding; workspace cleanup removes its bindings. Main still owns account/source/head validation.
- Thread replies capture their draft key, text, version and composer identity before awaiting a send. Only the unchanged submitted draft is cleared. New-origin composers remount with the corresponding draft; old completions cannot close them. Editing/retyping even identical text increments a version so an old completion cannot erase the newer draft.
- Summary publication also pins its draft/operation identity. A late result may clear only its unchanged submitted draft and cannot close or update a replacement review. Opening another origin reloads the matching saved summary.

## Verification

The original two actual-component reproductions failed before the patch and now pass. Seven surface tests cover immediate-route bypass, late completion after unmount, independent provider/workspace bindings, saved-session round trip, visible new-origin reply preservation, identical text retyped after cancel/reopen, and late summary completion. Five existing publication-hook tests pass (the ordinary-review reset test now explicitly closes the previous review first). Eighty-nine existing review store/navigation/tab/persistence tests pass: **101 tests total**. All RPC calls are synthetic; no real posts, GUI actions or global settings were used.

Desktop build passes. Biome has no errors. Renderer/test TypeScript checks retain existing global diagnostics; no diagnostics in owned paths. Saved-session recovery uses the app's existing snapshot lifecycle, not a new synchronous crash-proof journal. Actual main/backend publication validation is independently reviewed by the parent lane.
