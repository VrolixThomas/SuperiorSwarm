import { useState } from "react";
import { trpc } from "../trpc/client";
import { GitHubPRList } from "./GitHubPRList";
import { SectionHeader } from "./SectionHeader";

export function GitHubPanel() {
	const { data: status } = trpc.github.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const utils = trpc.useUtils();

	const connectMutation = trpc.github.connect.useMutation({
		onSuccess: () => utils.github.getStatus.invalidate(),
		onError: (err) => console.error("[GitHub] Connection failed:", err.message),
	});
	const disconnectMutation = trpc.github.disconnect.useMutation({
		onSuccess: () => {
			utils.github.getStatus.invalidate();
			utils.github.getMyPRs.invalidate();
			utils.github.getLinkedPRs.invalidate();
		},
	});

	const { data: prs } = trpc.github.getMyPRs.useQuery(undefined, {
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
					{connectMutation.isPending ? "Connecting..." : "Connect GitHub"}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<SectionHeader
				label="GitHub"
				count={prs?.length}
				isOpen={isOpen}
				onToggle={() => setIsOpen(!isOpen)}
			/>
			{isOpen && (
				<div className="px-2">
					<GitHubPRList />
				</div>
			)}
			<div className="px-3 py-1">
				<button
					type="button"
					onClick={() => disconnectMutation.mutate()}
					disabled={disconnectMutation.isPending}
					className="text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] disabled:opacity-50"
				>
					{disconnectMutation.isPending ? "Disconnecting..." : "Disconnect GitHub"}
				</button>
			</div>
		</div>
	);
}
