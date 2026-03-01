import { useState } from "react";
import type { DiffContext } from "../../shared/diff-types";
import type { DiffFile } from "../../shared/diff-types";
import { detectLanguage } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";

interface TreeNode {
	name: string;
	path: string;
	file?: DiffFile;
	children: Record<string, TreeNode>;
}

function buildTree(files: DiffFile[]): TreeNode {
	const root: TreeNode = { name: "", path: "", children: {} };
	for (const file of files) {
		const parts = file.path.split("/");
		let current = root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i] ?? "";
			if (!current.children[part]) {
				const partPath = parts.slice(0, i + 1).join("/");
				current.children[part] = { name: part, path: partPath, children: {} };
			}
			current = current.children[part]!;
		}
		current.file = file;
	}
	return root;
}

const STATUS_COLORS: Record<DiffFile["status"], string> = {
	added: "text-[var(--term-green)]",
	modified: "text-[var(--term-yellow)]",
	deleted: "text-[var(--term-red)]",
	renamed: "text-[var(--accent)]",
	binary: "text-[var(--text-quaternary)]",
};

const STATUS_LABELS: Record<DiffFile["status"], string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
	binary: "B",
};

function FileNode({
	node,
	diffCtx,
	workspaceId,
	actionButton,
}: {
	node: TreeNode;
	diffCtx: DiffContext;
	workspaceId: string;
	actionButton?: { icon: string; title: string; onClick: (path: string) => void };
}) {
	const activeTabId = useTabStore((s) => s.activeTabId);
	const tabs = useTabStore((s) => s.tabs);
	const openDiffFile = useTabStore((s) => s.openDiffFile);
	const file = node.file!;

	const activeTab = tabs.find((t) => t.id === activeTabId);
	const isActive = activeTab?.kind === "diff-file" && activeTab.filePath === file.path;

	function handleClick() {
		openDiffFile(workspaceId, diffCtx, file.path, detectLanguage(file.path));
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: Cannot use <button> — this element contains a child <button> for the action icon, and nested buttons are invalid HTML that breaks event propagation.
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
				"group flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] transition-all duration-[120ms]",
				isActive
					? "bg-[var(--bg-elevated)] text-[var(--text)]"
					: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
			].join(" ")}
		>
			<span className={`shrink-0 text-[11px] font-mono ${STATUS_COLORS[file.status]}`}>
				{STATUS_LABELS[file.status]}
			</span>
			<span className="min-w-0 flex-1 truncate">{node.name}</span>
			<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
				{file.additions > 0 && <span className="text-[var(--term-green)]">+{file.additions}</span>}
				{file.deletions > 0 && (
					<span className="ml-0.5 text-[var(--term-red)]">-{file.deletions}</span>
				)}
			</span>
			{actionButton && (
				<button
					type="button"
					title={actionButton.title}
					onClick={(e) => {
						e.stopPropagation();
						actionButton.onClick(file.path);
					}}
					className="ml-0.5 shrink-0 rounded p-0.5 text-[11px] text-[var(--text-quaternary)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--text-secondary)]"
				>
					{actionButton.icon}
				</button>
			)}
		</div>
	);
}

function FolderNode({
	node,
	depth,
	diffCtx,
	workspaceId,
	actionButton,
}: {
	node: TreeNode;
	depth: number;
	diffCtx: DiffContext;
	workspaceId: string;
	actionButton?: { icon: string; title: string; onClick: (path: string) => void };
}) {
	const [expanded, setExpanded] = useState(true);
	const children = Object.values(node.children).sort((a, b) => {
		const aIsFolder = Object.keys(a.children).length > 0;
		const bIsFolder = Object.keys(b.children).length > 0;
		if (aIsFolder && !bIsFolder) return -1;
		if (!aIsFolder && bIsFolder) return 1;
		return a.name.localeCompare(b.name);
	});

	return (
		<div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
			{depth > 0 && (
				<button
					type="button"
					onClick={() => setExpanded((e) => !e)}
					className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
				>
					<span className="shrink-0 text-[10px]">{expanded ? "▾" : "▸"}</span>
					<span className="truncate">{node.name}</span>
				</button>
			)}
			{expanded &&
				children.map((child) =>
					child.file ? (
						<FileNode
							key={child.path}
							node={child}
							diffCtx={diffCtx}
							workspaceId={workspaceId}
							actionButton={actionButton}
						/>
					) : (
						<FolderNode
							key={child.path}
							node={child}
							depth={depth + 1}
							diffCtx={diffCtx}
							workspaceId={workspaceId}
							actionButton={actionButton}
						/>
					)
				)}
		</div>
	);
}

export function FileTree({
	files,
	diffCtx,
	workspaceId,
	actionButton,
}: {
	files: DiffFile[];
	diffCtx: DiffContext;
	workspaceId: string;
	actionButton?: { icon: string; title: string; onClick: (path: string) => void };
}) {
	const root = buildTree(files);
	return (
		<FolderNode
			node={root}
			depth={0}
			diffCtx={diffCtx}
			workspaceId={workspaceId}
			actionButton={actionButton}
		/>
	);
}

export function FileSection({
	label,
	files,
	diffCtx,
	workspaceId,
	actionButton,
	bulkAction,
}: {
	label: string;
	files: DiffFile[];
	diffCtx: DiffContext;
	workspaceId: string;
	actionButton?: { icon: string; title: string; onClick: (path: string) => void };
	bulkAction?: { icon: string; title: string; onClick: () => void };
}) {
	const [expanded, setExpanded] = useState(true);

	if (files.length === 0) return null;

	return (
		<div>
			<div className="flex items-center gap-1 px-2 py-1">
				<button
					type="button"
					onClick={() => setExpanded((e) => !e)}
					className="flex flex-1 items-center gap-1 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
				>
					<span className="text-[10px]">{expanded ? "▾" : "▸"}</span>
					<span className="truncate">
						{label} ({files.length})
					</span>
				</button>
				{bulkAction && (
					<button
						type="button"
						title={bulkAction.title}
						onClick={bulkAction.onClick}
						className="shrink-0 rounded p-0.5 text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
					>
						{bulkAction.icon}
					</button>
				)}
			</div>
			{expanded && (
				<FileTree
					files={files}
					diffCtx={diffCtx}
					workspaceId={workspaceId}
					actionButton={actionButton}
				/>
			)}
		</div>
	);
}
