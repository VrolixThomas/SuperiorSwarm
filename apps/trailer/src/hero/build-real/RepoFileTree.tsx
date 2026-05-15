// Mirrors apps/desktop/src/renderer/components/RepoFileTree.tsx static render path.

interface TreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children: TreeNode[];
}

const EXT_COLORS: Record<string, string> = {
	ts: "#3178c6",
	tsx: "#3178c6",
	js: "#f7df1e",
	jsx: "#f7df1e",
	mjs: "#f7df1e",
	cjs: "#f7df1e",
	json: "#69db7c",
	css: "#a855f6",
	scss: "#a855f6",
	md: "#e1e1e3",
	mdx: "#e1e1e3",
	html: "#e34c26",
	htm: "#e34c26",
	svg: "#ffb13b",
	yaml: "#cb171e",
	yml: "#cb171e",
	toml: "#9c4221",
	sh: "#4eaa25",
	bash: "#4eaa25",
	zsh: "#4eaa25",
	py: "#3776ab",
	rs: "#dea584",
	go: "#00add8",
	sql: "#e38c00",
};

function getFileColor(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	return EXT_COLORS[ext] ?? "var(--text-quaternary)";
}

function FolderIcon({ open }: { open: boolean }) {
	if (open) {
		return (
			<svg
				aria-hidden="true"
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="currentColor"
				className="shrink-0"
			>
				<path
					d="M1.75 2.5A.75.75 0 012.5 1.75h4.035a.75.75 0 01.573.268l1.2 1.427a.25.25 0 00.191.089h5.001a.75.75 0 01.75.75v1.216H2.5v-3z"
					opacity="0.5"
				/>
				<path d="M1.5 5.5l1.197 7.182A.75.75 0 003.44 13.5h9.12a.75.75 0 00.743-.818L14.5 5.5H1.5z" />
			</svg>
		);
	}
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="currentColor"
			className="shrink-0"
		>
			<path d="M2.5 1.75A.75.75 0 013.25 1h4.035a.75.75 0 01.573.268l1.2 1.427a.25.25 0 00.191.089h4.001a.75.75 0 01.75.75v9.716a.75.75 0 01-.75.75H3.25a.75.75 0 01-.75-.75V1.75z" />
		</svg>
	);
}

function FileIcon({ color }: { color: string }) {
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 16 16"
			className="shrink-0"
			style={{ color }}
		>
			<path
				d="M3.5 1.75v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V5.5H9.25A1.25 1.25 0 018 4.25V1.5H3.75a.25.25 0 00-.25.25z"
				fill="currentColor"
				opacity="0.7"
			/>
			<path d="M9.5 1.5v2.75c0 .138.112.25.25.25h2.75L9.5 1.5z" fill="currentColor" />
		</svg>
	);
}

function ChevronIcon({ open }: { open: boolean }) {
	return (
		<svg
			aria-hidden="true"
			width="10"
			height="10"
			viewBox="0 0 16 16"
			fill="currentColor"
			className="shrink-0 text-[var(--text-quaternary)] transition-transform duration-150"
			style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
		>
			<path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
		</svg>
	);
}

const TREE: TreeNode[] = [
	{
		name: "src",
		path: "src",
		type: "directory",
		children: [
			{
				name: "renderer",
				path: "src/renderer",
				type: "directory",
				children: [
					{
						name: "components",
						path: "src/renderer/components",
						type: "directory",
						children: [
							{
								name: "Sidebar.tsx",
								path: "src/renderer/components/Sidebar.tsx",
								type: "file",
								children: [],
							},
							{
								name: "Terminal.tsx",
								path: "src/renderer/components/Terminal.tsx",
								type: "file",
								children: [],
							},
							{
								name: "DiffPanel.tsx",
								path: "src/renderer/components/DiffPanel.tsx",
								type: "file",
								children: [],
							},
							{
								name: "MainPane.tsx",
								path: "src/renderer/components/MainPane.tsx",
								type: "file",
								children: [],
							},
						],
					},
					{
						name: "hooks",
						path: "src/renderer/hooks",
						type: "directory",
						children: [
							{
								name: "useAgentTerminalStream.ts",
								path: "src/renderer/hooks/useAgentTerminalStream.ts",
								type: "file",
								children: [],
							},
							{
								name: "useRepoSubscription.ts",
								path: "src/renderer/hooks/useRepoSubscription.ts",
								type: "file",
								children: [],
							},
						],
					},
					{
						name: "stores",
						path: "src/renderer/stores",
						type: "directory",
						children: [
							{
								name: "tab-store.ts",
								path: "src/renderer/stores/tab-store.ts",
								type: "file",
								children: [],
							},
							{
								name: "branch-store.ts",
								path: "src/renderer/stores/branch-store.ts",
								type: "file",
								children: [],
							},
						],
					},
					{
						name: "App.tsx",
						path: "src/renderer/App.tsx",
						type: "file",
						children: [],
					},
				],
			},
		],
	},
];

const EXPANDED: Set<string> = new Set(["src", "src/renderer", "src/renderer/hooks"]);
const ACTIVE_PATH = "src/renderer/hooks/useAgentTerminalStream.ts";

function TreeNodeRow({
	node,
	depth,
	expanded,
	isActive,
}: {
	node: TreeNode;
	depth: number;
	expanded: boolean;
	isActive: boolean;
}) {
	const isDir = node.type === "directory";
	const displayName = node.name;

	return (
		<div
			data-path={node.path}
			className={[
				"group relative flex w-full items-center gap-1 rounded-[var(--radius-sm)] py-[3px] pr-2 text-left text-[12px] transition-colors duration-[120ms]",
				isActive
					? "bg-[var(--accent)]/10 text-[var(--text)]"
					: isDir
						? "text-[var(--text-tertiary)]"
						: "text-[var(--text-secondary)]",
			].join(" ")}
			style={{ paddingLeft: depth * 16 + 6 }}
		>
			{depth > 0 &&
				Array.from({ length: depth }, (_, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: static indent guides
						key={`guide-${i}`}
						className="absolute top-0 bottom-0 w-px bg-[var(--border-subtle)] opacity-50"
						style={{ left: i * 16 + 14 }}
					/>
				))}

			{isDir ? <ChevronIcon open={expanded} /> : <span className="w-[10px] shrink-0" />}

			{isDir ? (
				<span className="text-[var(--text-quaternary)]">
					<FolderIcon open={expanded} />
				</span>
			) : (
				<FileIcon color={getFileColor(displayName)} />
			)}

			<span className="min-w-0 flex-1 truncate">{displayName}</span>
		</div>
	);
}

function TreeBranch({
	nodes,
	depth,
}: {
	nodes: TreeNode[];
	depth: number;
}) {
	return (
		<>
			{nodes.map((node) => {
				const isExpanded = EXPANDED.has(node.path);
				const isDir = node.type === "directory";

				return (
					<div key={node.path}>
						<TreeNodeRow
							node={node}
							depth={depth}
							expanded={isExpanded}
							isActive={node.path === ACTIVE_PATH}
						/>
						{isDir && isExpanded && node.children.length > 0 && (
							<TreeBranch nodes={node.children} depth={depth + 1} />
						)}
					</div>
				);
			})}
		</>
	);
}

export function RepoFileTree() {
	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex-1 overflow-y-auto px-1 py-1 outline-none">
				<TreeBranch nodes={TREE} depth={0} />
			</div>
		</div>
	);
}
