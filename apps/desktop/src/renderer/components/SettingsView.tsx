import { useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ReviewPromptEditor } from "./ReviewPromptEditor";

function IntegrationRow({
	name,
	icon,
	connected,
	isPending,
	onConnect,
	onDisconnect,
}: {
	name: string;
	icon: React.ReactNode;
	connected: boolean;
	isPending: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}) {
	return (
		<div className="flex items-center gap-3 rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
			<div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
				{icon}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-[13px] font-medium text-[var(--text)]">{name}</span>
				<div className="flex items-center gap-1.5">
					<div
						className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-[#32d74b]" : "bg-[var(--text-quaternary)]"}`}
					/>
					<span className="text-[11px] text-[var(--text-tertiary)]">
						{connected ? "Connected" : "Not connected"}
					</span>
				</div>
			</div>
			{connected ? (
				<button
					type="button"
					onClick={onDisconnect}
					disabled={isPending}
					className="shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[rgba(255,59,48,0.1)] hover:text-[#ff453a] disabled:opacity-50"
				>
					{isPending ? "..." : "Disconnect"}
				</button>
			) : (
				<button
					type="button"
					onClick={onConnect}
					disabled={isPending}
					className="shrink-0 rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
				>
					{isPending ? "..." : "Connect"}
				</button>
			)}
		</div>
	);
}

export function SettingsView() {
	const { closeSettings } = useProjectStore();
	const utils = trpc.useUtils();
	const [view, setView] = useState<"main" | "prompt-editor">("main");

	// Atlassian (Jira + Bitbucket)
	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const atlassianConnect = trpc.atlassian.connect.useMutation({
		onSuccess: () => utils.atlassian.getStatus.invalidate(),
	});
	const atlassianDisconnect = trpc.atlassian.disconnect.useMutation({
		onSuccess: () => {
			utils.atlassian.getStatus.invalidate();
			utils.atlassian.getMyPullRequests.invalidate();
			utils.atlassian.getReviewRequests.invalidate();
			utils.atlassian.getMyIssues.invalidate();
			utils.tickets.getLinkedTickets.invalidate();
		},
	});

	// Linear
	const { data: linearStatus } = trpc.linear.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const linearConnect = trpc.linear.connect.useMutation({
		onSuccess: () => utils.linear.getStatus.invalidate(),
	});
	const linearDisconnect = trpc.linear.disconnect.useMutation({
		onSuccess: () => {
			utils.linear.getStatus.invalidate();
			utils.linear.getTeams.invalidate();
			utils.linear.getSelectedTeam.invalidate();
			utils.linear.getAssignedIssues.invalidate();
			utils.tickets.getLinkedTickets.invalidate();
		},
	});

	// GitHub
	const { data: githubStatus } = trpc.github.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const githubConnect = trpc.github.connect.useMutation({
		onSuccess: () => utils.github.getStatus.invalidate(),
	});
	const githubDisconnect = trpc.github.disconnect.useMutation({
		onSuccess: () => {
			utils.github.getStatus.invalidate();
			utils.github.getMyPRs.invalidate();
			utils.github.getLinkedPRs.invalidate();
		},
	});

	// AI Code Review
	const { data: aiSettings } = trpc.aiReview.getSettings.useQuery(undefined, {
		staleTime: 30_000,
	});
	const updateAiSettings = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	if (view === "prompt-editor") {
		return <ReviewPromptEditor onBack={() => setView("main")} />;
	}

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 pb-4">
				<button
					type="button"
					onClick={closeSettings}
					className="flex size-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<path
							d="M10 3L5 8l5 5"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<span className="text-[13px] font-semibold text-[var(--text)]">Settings</span>
			</div>

			{/* Integrations section */}
			<div className="flex-1 overflow-y-auto px-2">
				<div className="px-3 pb-2">
					<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
						Integrations
					</span>
				</div>

				<div className="flex flex-col gap-0.5">
					{/* Jira */}
					<IntegrationRow
						name="Jira"
						icon={
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<path d="M8.5 0a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5h-5zM2.5 7a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5h-5z" />
							</svg>
						}
						connected={atlassianStatus?.jira.connected ?? false}
						isPending={atlassianConnect.isPending || atlassianDisconnect.isPending}
						onConnect={() => atlassianConnect.mutate({ service: "jira" })}
						onDisconnect={() => atlassianDisconnect.mutate({ service: "jira" })}
					/>

					{/* Bitbucket */}
					<IntegrationRow
						name="Bitbucket"
						icon={
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<path d="M1.5 1h13l-1.5 14h-10L1.5 1zm8.5 10l.5-4h-5l.5 4h4z" />
							</svg>
						}
						connected={atlassianStatus?.bitbucket.connected ?? false}
						isPending={atlassianConnect.isPending || atlassianDisconnect.isPending}
						onConnect={() => atlassianConnect.mutate({ service: "bitbucket" })}
						onDisconnect={() => atlassianDisconnect.mutate({ service: "bitbucket" })}
					/>

					{/* Linear */}
					<IntegrationRow
						name="Linear"
						icon={
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.5 11.5L4.5 11.5V4.5L11.5 4.5v7z" />
							</svg>
						}
						connected={linearStatus?.connected ?? false}
						isPending={linearConnect.isPending || linearDisconnect.isPending}
						onConnect={() => linearConnect.mutate()}
						onDisconnect={() => linearDisconnect.mutate()}
					/>

					{/* GitHub */}
					<IntegrationRow
						name="GitHub"
						icon={
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
							</svg>
						}
						connected={githubStatus?.connected ?? false}
						isPending={githubConnect.isPending || githubDisconnect.isPending}
						onConnect={() => githubConnect.mutate()}
						onDisconnect={() => githubDisconnect.mutate()}
					/>
				</div>

				{/* AI Code Review section */}
				<div className="mt-6 px-3 pb-2">
					<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
						AI Code Review
					</span>
				</div>

				<div className="flex flex-col gap-0.5 px-3">
					{/* CLI Preset */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">Review Tool</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								CLI tool used for AI-powered code review
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

					{/* Auto Review Toggle */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">Automatic Review</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								Automatically review PRs when you're added as reviewer
							</span>
						</div>
						<button
							type="button"
							onClick={() =>
								updateAiSettings.mutate({
									autoReviewEnabled: !aiSettings?.autoReviewEnabled,
								})
							}
							className={`relative h-[22px] w-[40px] rounded-full transition-colors ${
								aiSettings?.autoReviewEnabled ? "bg-[var(--accent)]" : "bg-[var(--bg-elevated)]"
							}`}
						>
							<div
								className={`absolute top-[2px] size-[18px] rounded-full bg-white transition-transform ${
									aiSettings?.autoReviewEnabled ? "translate-x-[20px]" : "translate-x-[2px]"
								}`}
							/>
						</button>
					</div>

					{/* Skip Permissions Toggle */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">
								Auto-accept tool calls
							</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								Skip permission prompts during AI review
							</span>
						</div>
						<button
							type="button"
							onClick={() =>
								updateAiSettings.mutate({
									skipPermissions: !(aiSettings?.skipPermissions ?? true),
								})
							}
							className={`relative h-[22px] w-[40px] rounded-full transition-colors ${
								(aiSettings?.skipPermissions ?? true)
									? "bg-[var(--accent)]"
									: "bg-[var(--bg-elevated)]"
							}`}
						>
							<div
								className={`absolute top-[2px] size-[18px] rounded-full bg-white transition-transform ${
									(aiSettings?.skipPermissions ?? true) ? "translate-x-[20px]" : "translate-x-[2px]"
								}`}
							/>
						</button>
					</div>

					{/* Auto-approve resolutions */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">
								Auto-approve resolutions
							</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								AI resolution decisions skip manual approval
							</span>
						</div>
						<button
							type="button"
							onClick={() =>
								updateAiSettings.mutate({
									autoApproveResolutions: !aiSettings?.autoApproveResolutions,
								})
							}
							className={`relative h-[24px] w-[42px] shrink-0 cursor-pointer rounded-full border-none transition-colors ${
								aiSettings?.autoApproveResolutions
									? "bg-[var(--accent)]"
									: "bg-[var(--bg-elevated)]"
							}`}
						>
							<div
								className={`absolute top-[3px] size-[18px] rounded-full bg-white shadow-sm transition-transform ${
									aiSettings?.autoApproveResolutions
										? "translate-x-[20px]"
										: "translate-x-[2px]"
								}`}
							/>
						</button>
					</div>

					{/* Auto-publish resolutions */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">
								Auto-publish resolutions
							</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								Approved resolutions publish to platform automatically
							</span>
						</div>
						<button
							type="button"
							onClick={() =>
								updateAiSettings.mutate({
									autoPublishResolutions: !aiSettings?.autoPublishResolutions,
								})
							}
							className={`relative h-[24px] w-[42px] shrink-0 cursor-pointer rounded-full border-none transition-colors ${
								aiSettings?.autoPublishResolutions
									? "bg-[var(--accent)]"
									: "bg-[var(--bg-elevated)]"
							}`}
						>
							<div
								className={`absolute top-[3px] size-[18px] rounded-full bg-white shadow-sm transition-transform ${
									aiSettings?.autoPublishResolutions
										? "translate-x-[20px]"
										: "translate-x-[2px]"
								}`}
							/>
						</button>
					</div>

					{/* Review Guidelines */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">Review Guidelines</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								{aiSettings?.customPrompt ? "Custom instructions" : "Default instructions"}
							</span>
						</div>
						<button
							type="button"
							onClick={() => setView("prompt-editor")}
							className="rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
						>
							Edit
						</button>
					</div>

					{/* Max Concurrent Reviews */}
					<div className="flex items-center justify-between rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
						<div className="flex flex-col gap-0.5">
							<span className="text-[13px] font-medium text-[var(--text)]">
								Max Concurrent Reviews
							</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
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
				</div>
			</div>
		</div>
	);
}
