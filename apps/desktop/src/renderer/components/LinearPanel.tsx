import { useState } from "react";
import { trpc } from "../trpc/client";
import { LinearIssueList } from "./LinearIssueList";
import { SectionHeader } from "./SectionHeader";

export function LinearPanel() {
	const { data: status } = trpc.linear.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const { data: issues } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		staleTime: 30_000,
		enabled: status?.connected === true,
	});

	const [isOpen, setIsOpen] = useState(true);

	if (!status?.connected) return null;

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
