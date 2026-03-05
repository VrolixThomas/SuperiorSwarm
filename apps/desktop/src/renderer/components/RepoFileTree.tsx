import { useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface FileEntry {
	name: string;
	path: string;
	type: "file" | "directory";
	size?: number;
}

function ExplorerFileNode({
	entry,
	repoPath,
	workspaceId,
}: {
	entry: FileEntry;
	repoPath: string;
	workspaceId: string;
}) {
	const activeTabId = useTabStore((s) => s.activeTabId);
	const tabs = useTabStore((s) => s.tabs);
	const openFile = useTabStore((s) => s.openFile);

	const activeTab = tabs.find((t) => t.id === activeTabId);
	const isActive =
		activeTab?.kind === "file" &&
		activeTab.repoPath === repoPath &&
		activeTab.filePath === entry.path;

	function handleClick() {
		openFile(workspaceId, repoPath, entry.path, detectLanguage(entry.path));
	}

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleClick();
				}
			}}
			className={[
				"flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] transition-all duration-[120ms]",
				isActive
					? "bg-[var(--bg-elevated)] text-[var(--text)]"
					: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
			].join(" ")}
		>
			<span className="min-w-0 flex-1 truncate">{entry.name}</span>
		</div>
	);
}

function ExplorerFolderNode({
	entry,
	depth,
	repoPath,
	workspaceId,
}: {
	entry: FileEntry;
	depth: number;
	repoPath: string;
	workspaceId: string;
}) {
	const [expanded, setExpanded] = useState(depth === 0);

	const dirQuery = trpc.diff.listDirectory.useQuery(
		{ repoPath, dirPath: entry.path },
		{ enabled: expanded, staleTime: 30_000 }
	);

	const children = dirQuery.data?.entries ?? [];

	return (
		<div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
			<button
				type="button"
				onClick={() => setExpanded((e) => !e)}
				className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
			>
				<span className="shrink-0 text-[10px]">{expanded ? "▾" : "▸"}</span>
				<span className="truncate">{entry.name}</span>
			</button>
			{expanded &&
				children.map((child) =>
					child.type === "directory" ? (
						<ExplorerFolderNode
							key={child.path}
							entry={child}
							depth={depth + 1}
							repoPath={repoPath}
							workspaceId={workspaceId}
						/>
					) : (
						<ExplorerFileNode
							key={child.path}
							entry={child}
							repoPath={repoPath}
							workspaceId={workspaceId}
						/>
					)
				)}
			{expanded && dirQuery.isFetching && children.length === 0 && (
				<div className="px-2 py-0.5 text-[11px] text-[var(--text-quaternary)]">Loading...</div>
			)}
		</div>
	);
}

export function RepoFileTree({
	repoPath,
	workspaceId,
}: {
	repoPath: string;
	workspaceId: string;
}) {
	const rootQuery = trpc.diff.listDirectory.useQuery({ repoPath }, { staleTime: 30_000 });

	if (rootQuery.isLoading) {
		return (
			<div className="flex items-center justify-center py-4 text-[12px] text-[var(--text-quaternary)]">
				Loading...
			</div>
		);
	}

	const entries = rootQuery.data?.entries ?? [];

	if (entries.length === 0) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">Empty directory</div>
		);
	}

	return (
		<div>
			{entries.map((entry) =>
				entry.type === "directory" ? (
					<ExplorerFolderNode
						key={entry.path}
						entry={entry}
						depth={0}
						repoPath={repoPath}
						workspaceId={workspaceId}
					/>
				) : (
					<ExplorerFileNode
						key={entry.path}
						entry={entry}
						repoPath={repoPath}
						workspaceId={workspaceId}
					/>
				)
			)}
		</div>
	);
}
