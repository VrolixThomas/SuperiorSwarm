import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc/client";
import { ReviewPromptEditor } from "../ReviewPromptEditor";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

export function AIReviewSettings() {
	const utils = trpc.useUtils();
	const [showPromptEditor, setShowPromptEditor] = useState(false);

	const { data: aiSettings } = trpc.aiReview.getSettings.useQuery(undefined, {
		staleTime: 30_000,
	});
	const updateAiSettings = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	const [localSolvePrompt, setLocalSolvePrompt] = useState(aiSettings?.solvePrompt ?? "");
	const lastServerValue = useRef(aiSettings?.solvePrompt ?? "");
	if (aiSettings?.solvePrompt !== undefined && aiSettings.solvePrompt !== lastServerValue.current) {
		lastServerValue.current = aiSettings.solvePrompt;
		setLocalSolvePrompt(aiSettings.solvePrompt ?? "");
	}

	useEffect(() => {
		const serverValue = aiSettings?.solvePrompt ?? "";
		if (localSolvePrompt === serverValue) return;

		const timer = setTimeout(() => {
			updateAiSettings.mutate({ solvePrompt: localSolvePrompt || null });
		}, 500);
		return () => clearTimeout(timer);
	}, [localSolvePrompt, aiSettings?.solvePrompt, updateAiSettings]);

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
			<PageHeading title="AI Review" subtitle="Configure automated code review behavior" />

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

				<div className="flex items-center justify-between px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">
							Max Concurrent Reviews
						</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">
							Limit parallel AI reviews to manage resources
						</span>
					</div>
					<select
						value={aiSettings?.maxConcurrentReviews ?? 3}
						onChange={(e) =>
							updateAiSettings.mutate({
								maxConcurrentReviews: Number(e.target.value),
							})
						}
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[12px] text-[var(--text)]"
					>
						{[1, 2, 3, 4, 5].map((n) => (
							<option key={n} value={n}>
								{n}
							</option>
						))}
					</select>
				</div>

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

			<SectionLabel>Automation</SectionLabel>
			<div className="mb-6 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
				<ToggleRow
					label="Automatic Review"
					description="Automatically review PRs when you're added as reviewer"
					checked={aiSettings?.autoReviewEnabled ?? false}
					onChange={() =>
						updateAiSettings.mutate({ autoReviewEnabled: !aiSettings?.autoReviewEnabled })
					}
				/>
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
				<ToggleRow
					label="Auto-solve PR comments"
					description="Automatically fix review comments when detected"
					checked={aiSettings?.autoSolveEnabled ?? false}
					onChange={() =>
						updateAiSettings.mutate({ autoSolveEnabled: !aiSettings?.autoSolveEnabled })
					}
				/>
			</div>

			<SectionLabel>Custom Instructions</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<div className="flex flex-col gap-2 px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">
							Custom solve instructions
						</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">
							Additional guidance for the AI when resolving comments
						</span>
					</div>
					<textarea
						value={localSolvePrompt}
						onChange={(e) => setLocalSolvePrompt(e.target.value)}
						rows={4}
						placeholder="Leave blank to use default instructions..."
						className="w-full resize-none rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 font-mono text-[11px] text-[var(--text)] placeholder-[var(--text-quaternary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
					/>
				</div>
			</div>
		</div>
	);
}
