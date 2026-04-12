import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc/client";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

const DEFAULT_SOLVE_INSTRUCTIONS =
	"Fix the review comments by making the requested code changes. Focus on understanding the reviewer's intent and making precise, minimal changes.";

type EditorMode = "edit" | "preview";

export function CommentSolverSettings() {
	const utils = trpc.useUtils();

	const { data: settings } = trpc.aiReview.getSettings.useQuery(undefined, { staleTime: 30_000 });
	const update = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	const [localPrompt, setLocalPrompt] = useState(settings?.solvePrompt ?? "");
	const [mode, setMode] = useState<EditorMode>("edit");
	const lastServerValue = useRef(settings?.solvePrompt ?? "");

	useEffect(() => {
		if (settings?.solvePrompt !== undefined && settings.solvePrompt !== lastServerValue.current) {
			lastServerValue.current = settings.solvePrompt;
			setLocalPrompt(settings.solvePrompt ?? "");
		}
	}, [settings?.solvePrompt]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: update.mutate is stable — mutation objects are recreated on render but semantically identical
	useEffect(() => {
		const serverValue = settings?.solvePrompt ?? "";
		if (localPrompt === serverValue) return;

		const timer = setTimeout(() => {
			update.mutate({ solvePrompt: localPrompt || null });
		}, 500);
		return () => clearTimeout(timer);
	}, [localPrompt, settings?.solvePrompt]);

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
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<div className="flex flex-col gap-3 px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">Instructions</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">
							Sent to the AI at the start of every solve session. Use this to guide coding style,
							constraints, or approach.
						</span>
					</div>

					{/* Edit / Preview toggle */}
					<div className="flex gap-1 self-start rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5">
						{(["edit", "preview"] as EditorMode[]).map((m) => (
							<button
								key={m}
								type="button"
								onClick={() => setMode(m)}
								className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors capitalize ${
									mode === m
										? "bg-[var(--bg-surface)] text-[var(--text)] shadow-sm"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								{m}
							</button>
						))}
					</div>

					{mode === "edit" ? (
						<textarea
							value={localPrompt}
							onChange={(e) => setLocalPrompt(e.target.value)}
							placeholder={DEFAULT_SOLVE_INSTRUCTIONS}
							rows={6}
							className="w-full resize-none rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 font-mono text-[11px] text-[var(--text)] placeholder-[var(--text-quaternary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
						/>
					) : (
						<div className="min-h-[120px] rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[12px] text-[var(--text)]">
							<MarkdownRenderer
								content={localPrompt || DEFAULT_SOLVE_INSTRUCTIONS}
								className="text-[12px]"
							/>
						</div>
					)}

					<button
						type="button"
						onClick={() => setLocalPrompt("")}
						className="self-start text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] underline"
					>
						Reset to default
					</button>
				</div>
			</div>
		</div>
	);
}
