import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../../stores/projects";
import { trpc } from "../../trpc/client";
import { PageHeading, SectionLabel } from "./SectionHeading";

export function LspSettings() {
	const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
	const [refreshKey, setRefreshKey] = useState(0);

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: selectedProjectId ?? "" },
		{ enabled: selectedProjectId != null }
	);

	const repoPath = projectQuery.data?.repoPath;

	const [entries, setEntries] = useState<
		Array<{ id: string; command: string; available: boolean }>
	>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!repoPath) {
			setEntries([]);
			setLoading(false);
			setError(null);
			return;
		}

		let canceled = false;
		setLoading(true);
		setError(null);

		window.electron.lsp
			.getHealth({ repoPath })
			.then((result) => {
				if (canceled) {
					return;
				}
				setEntries(result.entries);
			})
			.catch((err: unknown) => {
				if (canceled) {
					return;
				}
				setEntries([]);
				setError(err instanceof Error ? err.message : "Failed to load LSP health.");
			})
			.finally(() => {
				if (!canceled) {
					setLoading(false);
				}
			});

		return () => {
			canceled = true;
		};
	}, [repoPath, refreshKey]);

	const sortedEntries = useMemo(
		() => [...entries].sort((a, b) => a.id.localeCompare(b.id)),
		[entries]
	);

	return (
		<div>
			<PageHeading
				title="Language Servers"
				subtitle="Status and diagnostics for language servers in the active repository"
			/>

			<SectionLabel>Health</SectionLabel>
			<div className="mb-3 flex items-center justify-between">
				<div className="text-[12px] text-[var(--text-tertiary)]">
					{repoPath ? repoPath : "Select a repository to view LSP health."}
				</div>
				<button
					type="button"
					onClick={() => setRefreshKey((k) => k + 1)}
					disabled={!repoPath || loading}
					className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] disabled:opacity-50"
				>
					{loading ? "Loading..." : "Refresh"}
				</button>
			</div>

			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				{!repoPath ? (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						No active repository selected
					</div>
				) : error ? (
					<div className="px-4 py-8 text-center text-[12px] text-[#ff453a]">{error}</div>
				) : loading ? (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						Loading language server health...
					</div>
				) : sortedEntries.length === 0 ? (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						No language servers configured
					</div>
				) : (
					sortedEntries.map((entry, index) => (
						<div
							key={entry.id}
							className={`flex items-center justify-between px-4 py-3 ${
								index > 0 ? "border-t border-[var(--border-subtle)]" : ""
							}`}
						>
							<div className="min-w-0 flex-1">
								<div className="text-[13px] font-medium text-[var(--text)]">{entry.id}</div>
								<div className="truncate font-mono text-[10px] text-[var(--text-quaternary)]">
									{entry.command}
								</div>
							</div>
							<span
								className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
									entry.available
										? "bg-[rgba(48,209,88,0.15)] text-[#30d158]"
										: "bg-[rgba(255,214,10,0.15)] text-[#ffd60a]"
								}`}
							>
								{entry.available ? "Installed" : "Missing"}
							</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
