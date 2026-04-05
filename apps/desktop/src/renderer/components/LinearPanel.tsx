import { useState } from "react";
import { trpc } from "../trpc/client";
import { ConnectBanner } from "./ConnectBanner";
import { LinearIssueList } from "./LinearIssueList";
import { SectionHeader } from "./SectionHeader";

export function LinearPanel() {
	const { data: status } = trpc.linear.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const { data: issues } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		staleTime: 30_000,
		enabled: status?.connected === true,
	});

	const [isOpen, setIsOpen] = useState(true);

	if (!status?.connected) {
		return (
			<div className="mt-2 border-t border-[var(--border-subtle)] px-3 py-2">
				<ConnectBanner message="Connect Linear to see issues." returnTo="prs" />
			</div>
		);
	}

	return (
		<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
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
		</div>
	);
}
