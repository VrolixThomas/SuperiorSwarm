import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../trpc/client";
import { BranchChip } from "./BranchChip";

export function SmartHeaderBar({
	repoPath,
	currentBranch,
	baseBranch,
	onBaseBranchChange,
	projectId,
}: {
	repoPath: string;
	currentBranch: string;
	baseBranch: string;
	onBaseBranchChange: (branch: string) => void;
	projectId?: string | null;
}) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [search, setSearch] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const branchesQuery = trpc.diff.listBranches.useQuery(
		{ repoPath },
		{ enabled: pickerOpen, staleTime: 30_000 }
	);

	const filtered = useMemo(() => {
		const branches = branchesQuery.data?.branches ?? [];
		const q = search.toLowerCase();
		return branches
			.filter((b) => b !== currentBranch && b.toLowerCase().includes(q))
			.sort((a, b) => a.localeCompare(b));
	}, [branchesQuery.data, search, currentBranch]);

	useEffect(() => {
		if (pickerOpen) {
			setSearch("");
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [pickerOpen]);

	// Close on click outside
	useEffect(() => {
		if (!pickerOpen) return;
		function handleClick(e: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setPickerOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [pickerOpen]);

	return (
		<div ref={containerRef} className="relative shrink-0 border-b border-[var(--border)]">
			<div className="flex items-center gap-1.5 px-3 py-1.5">
				{/* BranchChip — opens branch palette */}
				{projectId && <BranchChip projectId={projectId} />}

				{/* Divider between chip and base branch picker */}
				{projectId && (
					<span className="text-[11px] text-[var(--text-quaternary)]">→</span>
				)}

				{/* Base branch picker label (hidden when chip is present to avoid redundancy) */}
				{!projectId && (
					<>
						{/* Branch icon */}
						<svg
							aria-hidden="true"
							width="10"
							height="10"
							viewBox="0 0 16 16"
							fill="currentColor"
							className="shrink-0 text-[var(--text-quaternary)]"
						>
							<path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
						</svg>
						<span className="truncate text-[12px] text-[var(--text-secondary)]">
							{currentBranch}
						</span>
						<span className="text-[11px] text-[var(--text-quaternary)]">→</span>
					</>
				)}
				<button
					type="button"
					onClick={() => setPickerOpen((o) => !o)}
					className="flex items-center gap-1 truncate rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<span className="truncate">{baseBranch}</span>
					<svg
						aria-hidden="true"
						width="8"
						height="8"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="shrink-0"
					>
						<path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
					</svg>
				</button>
			</div>

			{/* Branch picker popover */}
			{pickerOpen && (
				<div className="absolute left-2 right-2 top-full z-50 mt-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]">
					<div className="p-1.5">
						<input
							ref={inputRef}
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search branches..."
							className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</div>
					<div className="max-h-[200px] overflow-y-auto px-1 pb-1">
						{filtered.length === 0 && (
							<div className="px-2 py-1.5 text-[11px] text-[var(--text-quaternary)]">
								No branches found
							</div>
						)}
						{filtered.map((branch) => (
							<button
								key={branch}
								type="button"
								onClick={() => {
									onBaseBranchChange(branch);
									setPickerOpen(false);
								}}
								className={[
									"flex w-full items-center rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] transition-colors duration-[120ms]",
									branch === baseBranch
										? "bg-[var(--bg-overlay)] text-[var(--text)]"
										: "text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
								].join(" ")}
							>
								<span className="truncate">{branch}</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
