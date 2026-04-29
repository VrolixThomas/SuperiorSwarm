import { useCallback } from "react";
import {
	renderSolveFollowUpFullPrompt,
	renderSolveFullPrompt,
} from "../../../shared/prompt-preview";
import { DEFAULT_SOLVE_PROMPT } from "../../../shared/solve-prompt";
import { trpc } from "../../trpc/client";
import { type FullPromptVariant, PromptEditor } from "./PromptEditor";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

const SOLVE_PROMPT_VARIANTS: FullPromptVariant[] = [
	{ key: "initial", label: "Initial Solve", render: renderSolveFullPrompt },
	{ key: "followup", label: "Follow-up Turn", render: renderSolveFollowUpFullPrompt },
];

export function CommentSolverSettings() {
	const utils = trpc.useUtils();

	const { data: settings } = trpc.aiReview.getSettings.useQuery(undefined, { staleTime: 30_000 });
	const update = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	const handlePromptChange = useCallback(
		(next: string | null) => {
			update.mutate({ solvePrompt: next });
		},
		[update]
	);

	return (
		<div>
			<PageHeading
				title="Comment Solver"
				subtitle="Configure the AI that fixes PR review comments"
			/>

			<div className="mb-6 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
				<ToggleRow
					label="Auto-solve PR comments"
					description="Automatically trigger a new solve session when new review comments are detected on a linked PR"
					checked={settings?.autoSolveEnabled ?? false}
					onChange={() => update.mutate({ autoSolveEnabled: !settings?.autoSolveEnabled })}
				/>
				<ToggleRow
					label="Auto-resolve threads on submit"
					description="Automatically mark comment threads as resolved on the platform when their fixes are pushed"
					checked={settings?.solveAutoResolveThreads ?? false}
					onChange={() =>
						update.mutate({
							solveAutoResolveThreads: !settings?.solveAutoResolveThreads,
						})
					}
				/>
				<div className="flex items-center justify-between px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">
							Max Concurrent Solves
						</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">
							How many solve sessions can run simultaneously across all workspaces
						</span>
					</div>
					<select
						value={settings?.maxConcurrentReviews ?? 3}
						onChange={(e) => update.mutate({ maxConcurrentReviews: Number(e.target.value) })}
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[12px] text-[var(--text)]"
					>
						{[1, 2, 3, 4, 5].map((n) => (
							<option key={n} value={n}>
								{n}
							</option>
						))}
					</select>
				</div>
			</div>

			<SectionLabel>Solve Instructions</SectionLabel>
			<PromptEditor
				value={settings?.solvePrompt}
				onChange={handlePromptChange}
				defaultPrompt={DEFAULT_SOLVE_PROMPT}
				fullPromptVariants={SOLVE_PROMPT_VARIANTS}
				title="Instructions"
				subtitle="Sent to the AI at the start of every solve session. Edit to change persona, scope rules, or reply tone. The MCP tool block is always appended so the app can track and commit fixes."
			/>
		</div>
	);
}
