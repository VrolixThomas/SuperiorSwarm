import { useId, useState } from "react";
import { CLI_PRESET_NAMES, type CliPresetName } from "../../../../shared/cli-preset";
import type { ReviewPathSource } from "../../../lib/review-path-source";
import { useReviewPathSettingsStore } from "../../../stores/review-path-settings-store";
import { trpc } from "../../../trpc/client";

const LABELS: Record<CliPresetName, string> = {
	claude: "Claude Code",
	gemini: "Gemini CLI",
	codex: "Codex",
	opencode: "OpenCode",
};

export function MapPathCard({ source }: { source: ReviewPathSource }) {
	const settings = useReviewPathSettingsStore();
	const {
		data: aiSettings,
		isPending,
		isError,
	} = trpc.aiReview.getSettings.useQuery(undefined, { staleTime: 30_000 });
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
	const agentId = selectedAgent ?? aiSettings?.cliPreset ?? "claude";
	const reasonId = useId();
	const supported = agentId === "codex" || agentId === "claude";
	const disabled = !source.available || isPending || isError || !supported;
	const reason =
		source.unavailableReason ??
		(!supported ? "Reading paths currently support Codex and Claude Code." : undefined) ??
		(isError ? "Review agent settings could not be loaded." : undefined);
	return (
		<section
			aria-label="Map reading path"
			className="m-3 shrink-0 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3.5"
		>
			<h2 className="text-[13px] font-semibold text-[var(--text)]">
				{source.status === "failed" ? "Reading path could not be mapped" : "No reading path yet"}
			</h2>
			<p className="mt-1.5 text-[12px] leading-[17px] text-[var(--text-secondary)]">
				Your agent orders these files from each entry point to its tests.
			</p>
			<div className="mt-3 flex flex-wrap gap-1.5">
				<button
					type="button"
					disabled={disabled}
					aria-describedby={reason ? reasonId : undefined}
					title={reason}
					onClick={() => source.start({ agentId, alsoReview: settings.alsoReview })}
					className="h-8 rounded-[6px] bg-[var(--accent)] px-3 text-[12px] font-semibold text-[var(--accent-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{source.status === "failed" ? "Retry mapping" : "Map this PR"}
				</button>
				<select
					aria-label="Mapping agent"
					value={agentId}
					onChange={(event) => setSelectedAgent(event.target.value)}
					className="min-w-0 max-w-full flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 text-[12px] text-[var(--text)]"
				>
					{CLI_PRESET_NAMES.map((id) => (
						<option key={id} value={id}>
							{LABELS[id]}
						</option>
					))}
				</select>
			</div>
			{(reason || source.path?.error) && (
				<p id={reasonId} className="mt-2 text-[11px] text-[var(--text-secondary)]">
					{reason ?? source.path?.error}
				</p>
			)}
			{settings.error && (
				<p role="alert" className="mt-2 text-[12px] text-[var(--color-danger)]">
					Could not save reading-path settings: {settings.error}
				</p>
			)}
			<label className="mt-3 flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
				<input
					aria-label="Also review the code"
					type="checkbox"
					checked={settings.alsoReview}
					onChange={(event) => settings.setAlsoReview(event.target.checked)}
					className="mt-0.5 accent-[var(--accent)]"
				/>
				Also review the code
			</label>
			<label className="mt-3 flex items-start gap-2 border-t border-[var(--border-subtle)] pt-3 text-[12px] leading-[17px] text-[var(--text-secondary)]">
				<input
					type="checkbox"
					checked={settings.autoMapOnReviewRequest}
					onChange={(event) => settings.setAutoMapOnReviewRequest(event.target.checked)}
					className="mt-0.5 accent-[var(--accent)]"
				/>
				Do this automatically when I'm asked to review a PR
			</label>
		</section>
	);
}
