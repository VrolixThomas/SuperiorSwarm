import { useState } from "react";
import type { DiffFile } from "../../shared/diff-types";
import { detectLanguage } from "../../shared/diff-types";
import { useDiffStore } from "../stores/diff";
import { useTabsStore } from "../stores/tabs";

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

function FileNode({ node }: { node: TreeNode }) {
	const { openFileTab, fileTabs, activePane } = useTabsStore();
	const { activeDiff } = useDiffStore();
	const file = node.file!;

	const isActive =
		activePane.kind === "file" &&
		fileTabs.find((t) => t.id === activePane.tabId)?.filePath === file.path;

	function handleClick() {
		if (!activeDiff) return;
		const filename = file.path.split("/").pop() ?? file.path;
		openFileTab({
			type: "diff-file",
			diffCtx: activeDiff,
			filePath: file.path,
			title: filename,
			language: detectLanguage(file.path),
		});
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			className={[
				"flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] transition-all duration-[120ms]",
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
		</button>
	);
}

function FolderNode({ node, depth }: { node: TreeNode; depth: number }) {
	const [expanded, setExpanded] = useState(true);
	const children = Object.values(node.children).sort((a, b) => {
		// Folders before files
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
						<FileNode key={child.path} node={child} />
					) : (
						<FolderNode key={child.path} node={child} depth={depth + 1} />
					)
				)}
		</div>
	);
}

export function FileTree({ files }: { files: DiffFile[] }) {
	const root = buildTree(files);
	return <FolderNode node={root} depth={0} />;
}
