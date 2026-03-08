import { useState } from "react";
import { trpc } from "../trpc/client";
import { GitHubPRList } from "./GitHubPRList";
import { SectionHeader } from "./SectionHeader";

export function GitHubPanel() {
	const { data: status } = trpc.github.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const { data: prs } = trpc.github.getMyPRs.useQuery(undefined, {
		staleTime: 30_000,
		enabled: status?.connected === true,
	});

	const [isOpen, setIsOpen] = useState(true);

	if (!status?.connected) return null;

	return (
		<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
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
		</div>
	);
}
