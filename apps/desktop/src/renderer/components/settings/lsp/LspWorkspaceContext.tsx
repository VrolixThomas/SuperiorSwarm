interface LspWorkspaceContextProps {
	repoPath: string | null;
}

export function LspWorkspaceContext({ repoPath }: LspWorkspaceContextProps) {
	return (
		<div className="mt-5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5">
			<div className="text-[10px] text-[var(--text-quaternary)]">
				{repoPath ? (
					<>
						Active workspace: <span className="text-[var(--text-tertiary)]">{repoPath}</span>
						{" · "}
						Health checks run against this repo's PATH
					</>
				) : (
					"No active workspace — showing global server status only"
				)}
			</div>
		</div>
	);
}
