import { useState } from "react";
import { trpc } from "../../trpc/client";
import { ReviewPromptEditor } from "../ReviewPromptEditor";
import { PageHeading } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

export function AIReviewerSettings() {
	const utils = trpc.useUtils();
	const [showPromptEditor, setShowPromptEditor] = useState(false);

	const { data: aiSettings } = trpc.aiReview.getSettings.useQuery(undefined, {
		staleTime: 30_000,
	});
	const updateAiSettings = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	if (showPromptEditor) {
		return (
			<div>
				<PageHeading
					title="Review Guidelines"
					subtitle="Customize the instructions sent to the AI reviewer"
				/>
				<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
					<div className="p-4">
						<ReviewPromptEditor onBack={() => setShowPromptEditor(false)} />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div>
			<PageHeading title="AI Reviewer" subtitle="Configure automated code review behavior" />

			<div className="mb-6 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
				<div className="flex items-center justify-between px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">Review Tool</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">
							CLI tool for AI-powered code review
						</span>
					</div>
					<select
						value={aiSettings?.cliPreset ?? "claude"}
						onChange={(e) =>
							updateAiSettings.mutate({
								cliPreset: e.target.value as "claude" | "gemini" | "codex" | "opencode",
							})
						}
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[12px] text-[var(--text)]"
					>
						<option value="claude">Claude Code</option>
						<option value="gemini">Gemini CLI</option>
						<option value="codex">Codex</option>
						<option value="opencode">OpenCode</option>
					</select>
				</div>

				<ToggleRow
					label="Auto-accept tool calls"
					description="Skip permission prompts during AI review"
					checked={aiSettings?.skipPermissions ?? true}
					onChange={() =>
						updateAiSettings.mutate({
							skipPermissions: !(aiSettings?.skipPermissions ?? true),
						})
					}
				/>

				<ToggleRow
					label="Automatic Review"
					description="Automatically review PRs when you're added as reviewer"
					checked={aiSettings?.autoReviewEnabled ?? false}
					onChange={() =>
						updateAiSettings.mutate({ autoReviewEnabled: !aiSettings?.autoReviewEnabled })
					}
				/>

				<ToggleRow
					label="Auto Re-review on New Commits"
					description="Automatically re-review when new commits are pushed to a PR"
					checked={aiSettings?.autoReReviewOnCommit ?? false}
					onChange={() =>
						updateAiSettings.mutate({
							autoReReviewOnCommit: !aiSettings?.autoReReviewOnCommit,
						})
					}
				/>

				<ToggleRow
					label="Auto-approve resolutions"
					description="AI resolution decisions skip manual approval"
					checked={aiSettings?.autoApproveResolutions ?? false}
					onChange={() =>
						updateAiSettings.mutate({
							autoApproveResolutions: !aiSettings?.autoApproveResolutions,
						})
					}
				/>

				<ToggleRow
					label="Auto-publish resolutions"
					description="Approved resolutions publish to platform automatically"
					checked={aiSettings?.autoPublishResolutions ?? false}
					onChange={() =>
						updateAiSettings.mutate({
							autoPublishResolutions: !aiSettings?.autoPublishResolutions,
						})
					}
				/>

				<div className="flex items-center justify-between px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">Review Guidelines</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">
							{aiSettings?.customPrompt ? "Custom instructions" : "Default instructions"}
						</span>
					</div>
					<button
						type="button"
						onClick={() => setShowPromptEditor(true)}
						className="rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					>
						Edit
					</button>
				</div>
			</div>
		</div>
	);
}
