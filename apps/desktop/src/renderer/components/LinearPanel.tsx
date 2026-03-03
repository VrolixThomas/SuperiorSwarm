import { useState } from "react";
import { trpc } from "../trpc/client";
import { LinearIssueList } from "./LinearIssueList";
import { SectionHeader } from "./SectionHeader";

export function LinearPanel() {
	const { data: status } = trpc.linear.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const utils = trpc.useUtils();

	const connectMutation = trpc.linear.connect.useMutation({
		onSuccess: () => utils.linear.getStatus.invalidate(),
		onError: (err) => console.error("[Linear] Connection failed:", err.message),
	});
	const disconnectMutation = trpc.linear.disconnect.useMutation({
		onSuccess: () => {
			utils.linear.getStatus.invalidate();
			utils.linear.getTeams.invalidate();
			utils.linear.getSelectedTeam.invalidate();
			utils.linear.getAssignedIssues.invalidate();
			utils.linear.getLinkedIssues.invalidate();
		},
	});

	const { data: issues } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		staleTime: 30_000,
		enabled: status?.connected === true,
	});

	const [isOpen, setIsOpen] = useState(true);

	if (!status?.connected) {
		return (
			<div className="px-2 py-1">
				<button
					type="button"
					onClick={() => connectMutation.mutate()}
					disabled={connectMutation.isPending}
					className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
				>
					{connectMutation.isPending ? "Connecting..." : "Connect Linear"}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<SectionHeader
				label="Linear"
				count={issues?.length}
				isOpen={isOpen}
				onToggle={() => setIsOpen(!isOpen)}
			/>
			{isOpen && (
				<div className="px-2">
					<LinearIssueList />
				</div>
			)}
			<div className="px-3 py-1">
				<button
					type="button"
					onClick={() => disconnectMutation.mutate()}
					disabled={disconnectMutation.isPending}
					className="text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] disabled:opacity-50"
				>
					{disconnectMutation.isPending ? "Disconnecting..." : "Disconnect Linear"}
				</button>
			</div>
		</div>
	);
}
