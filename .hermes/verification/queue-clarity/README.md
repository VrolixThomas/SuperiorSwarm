# Actionable workspace queue copy

The previous view named workspaces and generic completion status without explaining what to do. A provider turn-ended event was also presented as task completion.

The read-time projection now distinguishes workspace updates, questions and provider chats, enriches terminal titles, and supplies a specific next step, navigation label and evidence heading. Actual question/report text is retained; generic lifecycle labels are filtered from evidence. Missing reply, permission or error text is explicit. Ready is now To review. Done is explained as queue dismissal, not sending a reply or completing work. No transcript retrieval, deduplication or lifecycle/mutation changes were added.

Validation: 38 focused projection/backend/React/model tests pass, including metadata enrichment without revision/fingerprint/target changes. Native Electron queue/sidebar regression passes across four window sizes, lifecycle actions and content states. Desktop build and changed-file Biome pass; renderer type diagnostics match the existing baseline. Graphify remains unavailable. Screenshots are synthetic isolated fixture content.
