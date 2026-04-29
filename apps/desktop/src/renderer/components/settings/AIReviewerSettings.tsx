import { useCallback } from "react";
import type { CliPresetName } from "../../../shared/cli-preset";
import {
	renderReviewFollowUpFullPrompt,
	renderReviewFullPrompt,
} from "../../../shared/prompt-preview";
import { DEFAULT_REVIEW_PROMPT } from "../../../shared/review-prompt";
import { trpc } from "../../trpc/client";
import { type FullPromptVariant, PromptEditor } from "./PromptEditor";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

const REVIEW_PROMPT_VARIANTS: FullPromptVariant[] = [
	{ key: "initial", label: "Initial Review", render: renderReviewFullPrompt },
	{ key: "followup", label: "Follow-up Review", render: renderReviewFollowUpFullPrompt },
];

export function AIReviewerSettings() {
	const utils = trpc.useUtils();

	const { data: aiSettings } = trpc.aiReview.getSettings.useQuery(undefined, {
		staleTime: 30_000,
	});
	const updateAiSettings = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	const handlePromptChange = useCallback(
		(next: string | null) => {
			updateAiSettings.mutate({ customPrompt: next });
		},
		[updateAiSettings]
	);

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
								cliPreset: e.target.value as CliPresetName,
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
			</div>

			<SectionLabel>Review Instructions</SectionLabel>
			<PromptEditor
				value={aiSettings?.customPrompt}
				onChange={handlePromptChange}
				defaultPrompt={DEFAULT_REVIEW_PROMPT}
				fullPromptVariants={REVIEW_PROMPT_VARIANTS}
				title="Instructions"
				subtitle="Sent to the AI at the start of every review. Edit to change persona, focus areas, or output format. The MCP tool block is always appended so the app can record findings."
			/>
		</div>
	);
}
