import { useProjectStore } from "../../stores/projects";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { PageHeading } from "./SectionHeading";

function IntegrationRow({
	name,
	icon,
	connected,
	displayName,
	email,
	isPending,
	onConnect,
	onDisconnect,
}: {
	name: string;
	icon: React.ReactNode;
	connected: boolean;
	displayName?: string;
	email?: string | null;
	isPending: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}) {
	return (
		<div className="flex items-center gap-3 px-4 py-3.5">
			<div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
				{icon}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-[13px] font-medium text-[var(--text)]">{name}</span>
				<div className="flex items-center gap-1.5">
					<div
						className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-[#32d74b]" : "bg-[var(--text-quaternary)]"}`}
					/>
					<span className="truncate text-[11px] text-[var(--text-tertiary)]">
						{connected
							? email && displayName
								? `${displayName} · ${email}`
								: (displayName ?? email ?? "Connected")
							: "Not connected"}
					</span>
				</div>
			</div>
			{connected ? (
				<button
					type="button"
					onClick={onDisconnect}
					disabled={isPending}
					className="shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[rgba(255,59,48,0.1)] hover:text-[var(--color-danger)] disabled:opacity-50"
				>
					{isPending ? "..." : "Disconnect"}
				</button>
			) : (
				<button
					type="button"
					onClick={onConnect}
					disabled={isPending}
					className="shrink-0 rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
				>
					{isPending ? "..." : "Connect"}
				</button>
			)}
		</div>
	);
}

export function IntegrationsSettings() {
	const utils = trpc.useUtils();

	const autoReturn = () => {
		const { settingsReturnTo, closeSettings } = useProjectStore.getState();
		if (settingsReturnTo) {
			closeSettings();
			useTabStore.getState().setSidebarSegment(settingsReturnTo);
		}
	};

	// Atlassian (Jira + Bitbucket)
	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const atlassianConnect = trpc.atlassian.connect.useMutation({
		onSuccess: () => {
			utils.atlassian.getStatus.invalidate();
			autoReturn();
		},
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
		onSuccess: () => {
			utils.linear.getStatus.invalidate();
			autoReturn();
		},
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
		onSuccess: () => {
			utils.github.getStatus.invalidate();
			autoReturn();
		},
	});
	const githubDisconnect = trpc.github.disconnect.useMutation({
		onSuccess: () => {
			utils.github.getStatus.invalidate();
			utils.github.getMyPRs.invalidate();
			utils.github.getLinkedPRs.invalidate();
		},
	});

	return (
		<div>
			<PageHeading title="Integrations" subtitle="Connect your development tools" />

			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
				<IntegrationRow
					name="Jira"
					icon={
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8.5 0a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5h-5zM2.5 7a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5h-5z" />
						</svg>
					}
					connected={atlassianStatus?.jira.connected ?? false}
					displayName={
						atlassianStatus?.jira.connected ? atlassianStatus.jira.displayName : undefined
					}
					email={atlassianStatus?.jira.connected ? atlassianStatus.jira.email : undefined}
					isPending={atlassianConnect.isPending || atlassianDisconnect.isPending}
					onConnect={() => atlassianConnect.mutate({ service: "jira" })}
					onDisconnect={() => atlassianDisconnect.mutate({ service: "jira" })}
				/>
				<IntegrationRow
					name="Bitbucket"
					icon={
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
							<path d="M1.5 1h13l-1.5 14h-10L1.5 1zm8.5 10l.5-4h-5l.5 4h4z" />
						</svg>
					}
					connected={atlassianStatus?.bitbucket.connected ?? false}
					displayName={
						atlassianStatus?.bitbucket.connected ? atlassianStatus.bitbucket.displayName : undefined
					}
					email={atlassianStatus?.bitbucket.connected ? atlassianStatus.bitbucket.email : undefined}
					isPending={atlassianConnect.isPending || atlassianDisconnect.isPending}
					onConnect={() => atlassianConnect.mutate({ service: "bitbucket" })}
					onDisconnect={() => atlassianDisconnect.mutate({ service: "bitbucket" })}
				/>
				<IntegrationRow
					name="Linear"
					icon={
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.5 11.5L4.5 11.5V4.5L11.5 4.5v7z" />
						</svg>
					}
					connected={linearStatus?.connected ?? false}
					displayName={linearStatus?.connected ? linearStatus.displayName : undefined}
					email={linearStatus?.connected ? linearStatus.email : undefined}
					isPending={linearConnect.isPending || linearDisconnect.isPending}
					onConnect={() => linearConnect.mutate()}
					onDisconnect={() => linearDisconnect.mutate()}
				/>
				<IntegrationRow
					name="GitHub"
					icon={
						<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
						</svg>
					}
					connected={githubStatus?.connected ?? false}
					displayName={githubStatus?.connected ? githubStatus.displayName : undefined}
					email={githubStatus?.connected ? githubStatus.email : undefined}
					isPending={githubConnect.isPending || githubDisconnect.isPending}
					onConnect={() => githubConnect.mutate()}
					onDisconnect={() => githubDisconnect.mutate()}
				/>
			</div>
		</div>
	);
}
