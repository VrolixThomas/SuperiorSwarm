import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { DiffFile } from "../../shared/diff-types";
import { detectLanguage } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface TreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children: TreeNode[];
}

interface FuzzyResult {
	path: string;
	name: string;
	score: number;
	indices: number[];
}

// ─── File Type Colors ───────────────────────────────────────────────────────────

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

const GIT_STATUS_COLORS: Record<DiffFile["status"], string> = {
	added: "var(--term-green)",
	modified: "var(--term-yellow)",
	deleted: "var(--term-red)",
	renamed: "var(--accent)",
	binary: "var(--text-quaternary)",
};

// ─── Icons ──────────────────────────────────────────────────────────────────────

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

function getFileColor(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	return EXT_COLORS[ext] ?? "var(--text-quaternary)";
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

function SearchIcon() {
	return (
		<svg
			aria-hidden="true"
			width="13"
			height="13"
			viewBox="0 0 16 16"
			fill="currentColor"
			className="shrink-0 text-[var(--text-quaternary)]"
		>
			<path d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z" />
		</svg>
	);
}

// ─── Fuzzy Search ───────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	let qi = 0;
	const indices: number[] = [];

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			indices.push(ti);
			qi++;
		}
	}

	if (qi !== q.length) return null;

	// Score: consecutive matches + earlier = better
	let score = 100;
	for (let i = 1; i < indices.length; i++) {
		if (indices[i] === (indices[i - 1] ?? 0) + 1) score += 15;
	}
	// Penalize late start
	score -= (indices[0] ?? 0) * 2;
	// Bonus for matching at word boundaries (after /, -, _, .)
	for (const idx of indices) {
		if (idx === 0 || /[/\-_.]/.test(target[idx - 1] ?? "")) score += 8;
	}
	// Bonus for shorter names (more specific match)
	score -= target.length * 0.5;

	return { score, indices };
}

function searchFiles(query: string, files: string[]): FuzzyResult[] {
	if (!query.trim()) return [];

	const hasSlash = query.includes("/");
	const results: FuzzyResult[] = [];

	for (const filePath of files) {
		const name = filePath.split("/").pop() ?? filePath;
		const target = hasSlash ? filePath : name;
		const match = fuzzyMatch(query, target);
		if (match) {
			results.push({
				path: filePath,
				name,
				score: match.score,
				indices: match.indices,
			});
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results;
}

// ─── Tree Building ──────────────────────────────────────────────────────────────

interface FlatEntry {
	path: string;
	type: "file" | "directory";
}

function buildTree(entries: FlatEntry[]): TreeNode[] {
	const root: TreeNode[] = [];

	for (const entry of entries) {
		const parts = entry.path.split("/");
		let current = root;
		let currentPath = "";

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i] ?? "";
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const isLast = i === parts.length - 1;

			let existing = current.find((n) => n.name === part);
			if (!existing) {
				existing = {
					name: part,
					path: currentPath,
					type: isLast ? entry.type : "directory",
					children: [],
				};
				current.push(existing);
			}

			if (!isLast) {
				current = existing.children;
			}
		}
	}

	function sortNodes(nodes: TreeNode[]) {
		nodes.sort((a, b) => {
			if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		for (const node of nodes) {
			if (node.children.length > 0) sortNodes(node.children);
		}
	}
	sortNodes(root);

	return root;
}

function compactTreeNodes(nodes: TreeNode[]): TreeNode[] {
	return nodes.map((node) => {
		if (node.type === "directory") {
			let current = node;
			const pathParts = [current.name];

			// Merge chains of single-child directories
			while (current.children.length === 1 && current.children[0]?.type === "directory") {
				current = current.children[0];
				pathParts.push(current.name);
			}

			// If the final dir has exactly one file child, merge it too
			if (current.children.length === 1 && current.children[0]?.type === "file") {
				const file = current.children[0];
				return {
					...file,
					name: [...pathParts, file.name].join("/"),
					children: [],
				};
			}

			return {
				...current,
				name: pathParts.join("/"),
				children: compactTreeNodes(current.children),
			};
		}
		return node;
	});
}

// Collect all ancestor paths for a file path
function getAncestorPaths(filePath: string): string[] {
	const parts = filePath.split("/");
	const ancestors: string[] = [];
	for (let i = 1; i < parts.length; i++) {
		ancestors.push(parts.slice(0, i).join("/"));
	}
	return ancestors;
}

// Flatten visible tree nodes for keyboard navigation
function flattenVisible(nodes: TreeNode[], expanded: Set<string>): TreeNode[] {
	const result: TreeNode[] = [];
	for (const node of nodes) {
		result.push(node);
		if (node.type === "directory" && expanded.has(node.path)) {
			result.push(...flattenVisible(node.children, expanded));
		}
	}
	return result;
}

// Check if any file in the subtree has git status
function hasGitStatusInSubtree(
	node: TreeNode,
	gitStatusMap: Map<string, DiffFile["status"]>
): boolean {
	if (node.type === "file") return gitStatusMap.has(node.path);
	return node.children.some((child) => hasGitStatusInSubtree(child, gitStatusMap));
}

// ─── Highlighted Name ───────────────────────────────────────────────────────────

function HighlightedName({
	name,
	indices,
}: {
	name: string;
	indices: number[];
}) {
	if (indices.length === 0) return <>{name}</>;

	const indexSet = new Set(indices);
	const parts: { text: string; highlight: boolean }[] = [];
	let current = "";
	let currentHighlight = false;

	for (let i = 0; i < name.length; i++) {
		const isHighlight = indexSet.has(i);
		if (isHighlight !== currentHighlight && current) {
			parts.push({ text: current, highlight: currentHighlight });
			current = "";
		}
		current += name[i];
		currentHighlight = isHighlight;
	}
	if (current) parts.push({ text: current, highlight: currentHighlight });

	return (
		<>
			{parts.map((p) =>
				p.highlight ? (
					<span key={p.text} className="text-[var(--accent)]">
						{p.text}
					</span>
				) : (
					<span key={p.text}>{p.text}</span>
				)
			)}
		</>
	);
}

// ─── Context Menu ───────────────────────────────────────────────────────────────

type ContextMenuItem = { label: string; action: () => void } | "separator";

function ContextMenu({
	x,
	y,
	items,
	onClose,
}: {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
}) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		function handleEscape(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [onClose]);

	return (
		<div
			ref={menuRef}
			className="fixed z-50 min-w-[160px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: x, top: y }}
		>
			{items.map((item, i) =>
				item === "separator" ? (
					<div key={`sep-${i}`} className="my-1 border-t border-[var(--border-subtle)]" />
				) : (
					<button
						key={item.label}
						type="button"
						onClick={item.action}
						className={[
							"flex w-full items-center px-3 py-1.5 text-left text-[12px] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]",
							item.label === "Delete"
								? "text-[var(--term-red)] hover:text-[var(--term-red)]"
								: "text-[var(--text-secondary)] hover:text-[var(--text)]",
						].join(" ")}
					>
						{item.label}
					</button>
				)
			)}
		</div>
	);
}

// ─── Inline Input ───────────────────────────────────────────────────────────────

function InlineInput({
	defaultValue,
	onSubmit,
	onCancel,
	depth,
}: {
	defaultValue: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
	depth: number;
}) {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const input = inputRef.current;
		if (input) {
			input.focus();
			// Select just the name part (without extension for files)
			const dotIdx = defaultValue.lastIndexOf(".");
			if (dotIdx > 0) {
				input.setSelectionRange(0, dotIdx);
			} else {
				input.select();
			}
		}
	}, [defaultValue]);

	return (
		<div
			className="flex items-center gap-1 rounded-[var(--radius-sm)] py-[2px] pr-2"
			style={{ paddingLeft: depth * 16 + 6 }}
		>
			<span className="w-[10px] shrink-0" />
			<input
				ref={inputRef}
				type="text"
				defaultValue={defaultValue}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						const val = e.currentTarget.value.trim();
						if (val) onSubmit(val);
						else onCancel();
					}
					if (e.key === "Escape") onCancel();
				}}
				onBlur={(e) => {
					const val = e.currentTarget.value.trim();
					if (val && val !== defaultValue) onSubmit(val);
					else onCancel();
				}}
				className="min-w-0 flex-1 rounded border border-[var(--accent)] bg-[var(--bg-base)] px-1.5 py-0.5 text-[12px] text-[var(--text)] outline-none"
			/>
		</div>
	);
}

// ─── Search Bar ─────────────────────────────────────────────────────────────────

function SearchBar({
	query,
	onChange,
	matchCount,
	matchIndex,
	onNext,
	onPrev,
	inputRef,
}: {
	query: string;
	onChange: (q: string) => void;
	matchCount: number;
	matchIndex: number;
	onNext: () => void;
	onPrev: () => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
}) {
	return (
		<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-2 py-1.5">
			<SearchIcon />
			<input
				ref={inputRef}
				type="text"
				value={query}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						if (e.shiftKey) onPrev();
						else onNext();
					}
					if (e.key === "Escape") {
						onChange("");
						e.currentTarget.blur();
					}
				}}
				placeholder="Search files..."
				className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)]"
			/>
			{query && matchCount > 0 && (
				<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
					{matchIndex + 1}/{matchCount}
				</span>
			)}
			{query && matchCount === 0 && (
				<span className="shrink-0 text-[10px] text-[var(--term-red)]">No match</span>
			)}
		</div>
	);
}

// ─── Breadcrumb Bar ─────────────────────────────────────────────────────────────

function BreadcrumbBar({
	filePath,
	onSegmentClick,
}: {
	filePath: string;
	onSegmentClick: (segmentPath: string) => void;
}) {
	const parts = filePath.split("/");

	return (
		<div className="flex items-center gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] px-3 py-1 scrollbar-none">
			{parts.map((part, i) => {
				const segmentPath = parts.slice(0, i + 1).join("/");
				const isLast = i === parts.length - 1;
				return (
					<div key={segmentPath} className="flex shrink-0 items-center gap-0.5">
						{i > 0 && (
							<svg
								aria-hidden="true"
								width="8"
								height="8"
								viewBox="0 0 16 16"
								fill="var(--text-quaternary)"
								className="shrink-0"
							>
								<path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
							</svg>
						)}
						<button
							type="button"
							onClick={() => onSegmentClick(segmentPath)}
							className={[
								"rounded px-1 py-0.5 text-[11px] transition-colors duration-[120ms]",
								isLast
									? "text-[var(--text-secondary)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
							].join(" ")}
						>
							{part}
						</button>
					</div>
				);
			})}
		</div>
	);
}

// ─── Toolbar ────────────────────────────────────────────────────────────────────

const toolbarBtnBase =
	"rounded px-1.5 py-0.5 transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]";
const toolbarBtnActive =
	"rounded px-1.5 py-0.5 transition-colors duration-[120ms] bg-[var(--bg-overlay)] text-[var(--text-secondary)]";
const toolbarBtnInactive = `${toolbarBtnBase} text-[var(--text-quaternary)]`;

function Toolbar({
	compact,
	showHidden,
	onToggleCompact,
	onToggleHidden,
	onExpandAll,
	onCollapseAll,
	onRefresh,
}: {
	compact: boolean;
	showHidden: boolean;
	onToggleCompact: () => void;
	onToggleHidden: () => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	onRefresh: () => void;
}) {
	return (
		<div className="flex items-center gap-0.5 border-b border-[var(--border-subtle)] px-2 py-1">
			<button
				type="button"
				onClick={onToggleCompact}
				title={compact ? "Expand folder chains" : "Compact folder chains"}
				className={compact ? toolbarBtnActive : toolbarBtnInactive}
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="currentColor"
					className="inline-block"
				>
					<path d="M0 3.75A.75.75 0 01.75 3h14.5a.75.75 0 010 1.5H.75A.75.75 0 010 3.75zm2 4A.75.75 0 012.75 7h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 7.75zm4 4a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z" />
				</svg>
			</button>
			<button
				type="button"
				onClick={onToggleHidden}
				title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
				className={showHidden ? toolbarBtnActive : toolbarBtnInactive}
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="currentColor"
					className="inline-block"
				>
					<path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 010 1.798c-.45.678-1.367 1.932-2.637 3.023C11.671 13.008 9.981 14 8 14s-3.671-.992-4.933-2.078C1.797 10.831.88 9.577.43 8.899a1.62 1.62 0 010-1.798c.45-.678 1.367-1.932 2.637-3.023C4.329 2.992 6.019 2 8 2zm0 10a4 4 0 100-8 4 4 0 000 8zm0-2a2 2 0 110-4 2 2 0 010 4z" />
				</svg>
			</button>
			<div className="flex-1" />
			<button type="button" onClick={onRefresh} title="Refresh" className={toolbarBtnInactive}>
				<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
					<path d="M8 3a5 5 0 104.546 2.914.75.75 0 011.36-.636A6.5 6.5 0 118 1.5v2A.75.75 0 019.25 3H8z" />
					<path d="M8 1.5V0l3 2.5L8 5V3a5 5 0 00-4.546 7.086.75.75 0 01-1.36.636A6.5 6.5 0 018 1.5z" />
				</svg>
			</button>
			<button type="button" onClick={onExpandAll} title="Expand all" className={toolbarBtnInactive}>
				<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
					<path d="M8 1a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 1z" />
				</svg>
			</button>
			<button
				type="button"
				onClick={onCollapseAll}
				title="Collapse all"
				className={toolbarBtnInactive}
			>
				<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
					<path d="M2 7.75A.75.75 0 012.75 7h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 7.75z" />
				</svg>
			</button>
		</div>
	);
}

// ─── Tree Node ──────────────────────────────────────────────────────────────────

function TreeNodeRow({
	node,
	depth,
	expanded,
	onToggle,
	onSelect,
	onContextMenu,
	isActive,
	isFocused,
	isSearchMatch,
	searchIndices,
	gitStatus,
	hasChildStatus,
}: {
	node: TreeNode;
	depth: number;
	expanded: boolean;
	onToggle: () => void;
	onSelect: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
	isActive: boolean;
	isFocused: boolean;
	isSearchMatch: boolean;
	searchIndices: number[];
	gitStatus?: DiffFile["status"];
	hasChildStatus: boolean;
}) {
	const isDir = node.type === "directory";
	const displayName = node.name;

	return (
		<div
			role="treeitem"
			tabIndex={-1}
			data-path={node.path}
			aria-expanded={isDir ? expanded : undefined}
			onClick={(e) => {
				e.stopPropagation();
				if (isDir) onToggle();
				else onSelect();
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					if (isDir) onToggle();
					else onSelect();
				}
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onContextMenu(e);
			}}
			className={[
				"group relative flex w-full cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] py-[3px] pr-2 text-left text-[12px] transition-colors duration-[120ms]",
				isActive
					? "bg-[var(--accent)]/10 text-[var(--text)]"
					: isFocused
						? "bg-[var(--bg-elevated)] text-[var(--text)]"
						: isSearchMatch
							? "bg-[var(--accent)]/5 text-[var(--text)]"
							: isDir
								? "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
								: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
			].join(" ")}
			style={{ paddingLeft: depth * 16 + 6 }}
		>
			{/* Indent guides */}
			{depth > 0 &&
				Array.from({ length: depth }, (_, i) => (
					<span
						key={`guide-${i}`}
						className="absolute top-0 bottom-0 w-px bg-[var(--border-subtle)] opacity-50"
						style={{ left: i * 16 + 14 }}
					/>
				))}

			{/* Chevron (dirs only) */}
			{isDir ? <ChevronIcon open={expanded} /> : <span className="w-[10px] shrink-0" />}

			{/* Icon */}
			{isDir ? (
				<span className="text-[var(--text-quaternary)]">
					<FolderIcon open={expanded} />
				</span>
			) : (
				<FileIcon color={getFileColor(displayName)} />
			)}

			{/* Name */}
			<span className="min-w-0 flex-1 truncate">
				{searchIndices.length > 0 ? (
					<HighlightedName name={displayName} indices={searchIndices} />
				) : (
					displayName
				)}
			</span>

			{/* Git status dot */}
			{gitStatus && (
				<span
					className="size-[6px] shrink-0 rounded-full"
					style={{ backgroundColor: GIT_STATUS_COLORS[gitStatus] }}
					title={gitStatus}
				/>
			)}
			{!gitStatus && hasChildStatus && isDir && (
				<span
					className="size-[5px] shrink-0 rounded-full opacity-40"
					style={{ backgroundColor: "var(--term-yellow)" }}
				/>
			)}
		</div>
	);
}

// ─── Recursive Tree Renderer ────────────────────────────────────────────────────

function TreeBranch({
	nodes,
	depth,
	expanded,
	onToggle,
	onFileSelect,
	onContextMenu,
	activeFilePath,
	focusedPath,
	searchMatchPaths,
	searchMatchIndicesMap,
	gitStatusMap,
	inlineInput,
	onInlineSubmit,
	onInlineCancel,
}: {
	nodes: TreeNode[];
	depth: number;
	expanded: Set<string>;
	onToggle: (path: string) => void;
	onFileSelect: (node: TreeNode) => void;
	onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
	activeFilePath: string | null;
	focusedPath: string | null;
	searchMatchPaths: Set<string>;
	searchMatchIndicesMap: Map<string, number[]>;
	gitStatusMap: Map<string, DiffFile["status"]>;
	inlineInput: InlineInputMode;
	onInlineSubmit: (value: string) => void;
	onInlineCancel: () => void;
}) {
	return (
		<>
			{nodes.map((node) => {
				const isExpanded = expanded.has(node.path);
				const isDir = node.type === "directory";
				const isRenaming = inlineInput?.type === "rename" && inlineInput.node.path === node.path;

				return (
					<div key={node.path}>
						{isRenaming ? (
							<InlineInput
								defaultValue={node.name.split("/").pop() ?? node.name}
								onSubmit={onInlineSubmit}
								onCancel={onInlineCancel}
								depth={depth}
							/>
						) : (
							<TreeNodeRow
								node={node}
								depth={depth}
								expanded={isExpanded}
								onToggle={() => onToggle(node.path)}
								onSelect={() => onFileSelect(node)}
								onContextMenu={(e) => onContextMenu(e, node)}
								isActive={node.path === activeFilePath}
								isFocused={node.path === focusedPath}
								isSearchMatch={searchMatchPaths.has(node.path)}
								searchIndices={searchMatchIndicesMap.get(node.path) ?? []}
								gitStatus={gitStatusMap.get(node.path)}
								hasChildStatus={isDir ? hasGitStatusInSubtree(node, gitStatusMap) : false}
							/>
						)}
						{isDir && isExpanded && (
							<>
								{/* Inline input for new file/folder inside this directory */}
								{inlineInput &&
									(inlineInput.type === "new-file" || inlineInput.type === "new-folder") &&
									inlineInput.parentPath === node.path && (
										<InlineInput
											defaultValue={inlineInput.type === "new-file" ? "untitled" : "new-folder"}
											onSubmit={onInlineSubmit}
											onCancel={onInlineCancel}
											depth={depth + 1}
										/>
									)}
								{node.children.length > 0 && (
									<TreeBranch
										nodes={node.children}
										depth={depth + 1}
										expanded={expanded}
										onToggle={onToggle}
										onFileSelect={onFileSelect}
										onContextMenu={onContextMenu}
										activeFilePath={activeFilePath}
										focusedPath={focusedPath}
										searchMatchPaths={searchMatchPaths}
										searchMatchIndicesMap={searchMatchIndicesMap}
										gitStatusMap={gitStatusMap}
										inlineInput={inlineInput}
										onInlineSubmit={onInlineSubmit}
										onInlineCancel={onInlineCancel}
									/>
								)}
							</>
						)}
					</div>
				);
			})}
		</>
	);
}

// ─── Inline input mode ──────────────────────────────────────────────────────────

type InlineInputMode =
	| { type: "new-file"; parentPath: string; depth: number }
	| { type: "new-folder"; parentPath: string; depth: number }
	| { type: "rename"; node: TreeNode; depth: number }
	| null;

// ─── Main Component ─────────────────────────────────────────────────────────────

export function RepoFileTree({
	repoPath,
	workspaceId,
}: {
	repoPath: string;
	workspaceId: string;
}) {
	// ── State ──────────────────────────────────────────────────
	const [searchQuery, setSearchQuery] = useState("");
	const [matchIndex, setMatchIndex] = useState(0);
	const [compact, setCompact] = useState(true);
	const [showHidden, setShowHidden] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [focusedPath, setFocusedPath] = useState<string | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		node?: TreeNode;
	} | null>(null);
	const [inlineInput, setInlineInput] = useState<InlineInputMode>(null);
	const [initialExpanded, setInitialExpanded] = useState(false);

	const searchInputRef = useRef<HTMLInputElement>(null);
	const treeContainerRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	// ── Store ──────────────────────────────────────────────────
	const openFile = useTabStore((s) => s.openFile);
	const activeTabId = useTabStore((s) => s.getActiveTabId());
	const tabs = useTabStore(useShallow((s) => s.getVisibleTabs()));

	const activeTab = tabs.find((t) => t.id === activeTabId);
	const activeFilePath =
		activeTab?.kind === "file" && activeTab.repoPath === repoPath ? activeTab.filePath : null;

	// ── Queries ────────────────────────────────────────────────
	const utils = trpc.useUtils();
	const filesQuery = trpc.diff.listAllFiles.useQuery({ repoPath }, { staleTime: 60_000 });
	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery({ repoPath }, { staleTime: 30_000 });

	const allEntries: FlatEntry[] = filesQuery.data?.entries ?? [];

	// ── Mutations ──────────────────────────────────────────────
	const invalidateFiles = useCallback(() => {
		utils.diff.listAllFiles.invalidate({ repoPath });
		utils.diff.getWorkingTreeStatus.invalidate({ repoPath });
		utils.diff.getWorkingTreeDiff.invalidate({ repoPath });
	}, [utils, repoPath]);

	const createFileMutation = trpc.diff.createFile.useMutation({ onSuccess: invalidateFiles });
	const createFolderMutation = trpc.diff.createFolder.useMutation({ onSuccess: invalidateFiles });
	const deleteMutation = trpc.diff.deleteFileOrFolder.useMutation({ onSuccess: invalidateFiles });
	const renameMutation = trpc.diff.renameFileOrFolder.useMutation({ onSuccess: invalidateFiles });
	const revealMutation = trpc.diff.revealInFinder.useMutation();

	// ── Git status map ─────────────────────────────────────────
	const gitStatusMap = useMemo(() => {
		const map = new Map<string, DiffFile["status"]>();
		if (statusQuery.data) {
			for (const f of [...statusQuery.data.stagedFiles, ...statusQuery.data.unstagedFiles]) {
				if (!map.has(f.path)) {
					map.set(f.path, f.status);
				}
			}
		}
		return map;
	}, [statusQuery.data]);

	// ── Filter hidden files ────────────────────────────────────
	const visibleEntries = useMemo(() => {
		if (showHidden) return allEntries;
		return allEntries.filter((e) => {
			const segments = e.path.split("/");
			return !segments.some((s) => s.startsWith(".") && s !== ".");
		});
	}, [allEntries, showHidden]);

	// ── Tree ───────────────────────────────────────────────────
	const rawTree = useMemo(() => buildTree(visibleEntries), [visibleEntries]);
	const tree = useMemo(() => (compact ? compactTreeNodes(rawTree) : rawTree), [rawTree, compact]);

	// Auto-expand root-level dirs on first load
	useEffect(() => {
		if (visibleEntries.length > 0 && !initialExpanded) {
			const rootDirs = new Set<string>();
			for (const node of tree) {
				if (node.type === "directory") {
					rootDirs.add(node.path);
				}
			}
			setExpanded(rootDirs);
			setInitialExpanded(true);
		}
	}, [visibleEntries, tree, initialExpanded]);

	// ── Search ─────────────────────────────────────────────────
	const visibleFilePaths = useMemo(
		() => visibleEntries.filter((e) => e.type === "file").map((e) => e.path),
		[visibleEntries]
	);
	const searchResults = useMemo(
		() => searchFiles(searchQuery, visibleFilePaths),
		[searchQuery, visibleFilePaths]
	);

	const searchMatchPaths = useMemo(
		() => new Set(searchResults.map((r) => r.path)),
		[searchResults]
	);

	const searchMatchIndicesMap = useMemo(() => {
		const map = new Map<string, number[]>();
		for (const result of searchResults) {
			map.set(result.path, result.indices);
		}
		return map;
	}, [searchResults]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally resets when searchQuery changes
	useEffect(() => {
		setMatchIndex(0);
	}, [searchQuery]);

	useEffect(() => {
		if (searchResults.length === 0) return;
		const safeIndex = matchIndex % searchResults.length;
		const result = searchResults[safeIndex];
		if (!result) return;

		const ancestors = getAncestorPaths(result.path);
		setExpanded((prev) => {
			const next = new Set(prev);
			for (const anc of ancestors) next.add(anc);
			function findCompactPaths(nodes: TreeNode[]) {
				for (const node of nodes) {
					if (node.type === "directory") {
						if (result.path.startsWith(`${node.path}/`)) next.add(node.path);
						findCompactPaths(node.children);
					}
				}
			}
			findCompactPaths(tree);
			return next;
		});

		requestAnimationFrame(() => {
			const el = treeContainerRef.current?.querySelector(
				`[data-path="${CSS.escape(result.path)}"]`
			);
			el?.scrollIntoView({ block: "center", behavior: "smooth" });
		});
	}, [matchIndex, searchResults, tree]);

	// Cmd+F focuses search bar only when focus is inside this panel
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "f" && e.metaKey && !e.shiftKey) {
				if (!panelRef.current?.contains(document.activeElement)) return;
				e.preventDefault();
				e.stopPropagation();
				searchInputRef.current?.focus();
				searchInputRef.current?.select();
			}
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);

	// ── Keyboard Navigation ────────────────────────────────────
	const visibleNodes = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

	const handleTreeKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (inlineInput) return;
			const currentIndex = visibleNodes.findIndex((n) => n.path === focusedPath);

			switch (e.key) {
				case "ArrowDown": {
					e.preventDefault();
					const next = Math.min(currentIndex + 1, visibleNodes.length - 1);
					const node = visibleNodes[next];
					if (node) {
						setFocusedPath(node.path);
						treeContainerRef.current
							?.querySelector(`[data-path="${CSS.escape(node.path)}"]`)
							?.scrollIntoView({ block: "nearest" });
					}
					break;
				}
				case "ArrowUp": {
					e.preventDefault();
					const prev = Math.max(currentIndex - 1, 0);
					const node = visibleNodes[prev];
					if (node) {
						setFocusedPath(node.path);
						treeContainerRef.current
							?.querySelector(`[data-path="${CSS.escape(node.path)}"]`)
							?.scrollIntoView({ block: "nearest" });
					}
					break;
				}
				case "ArrowRight": {
					e.preventDefault();
					const node = visibleNodes[currentIndex];
					if (node?.type === "directory") {
						if (!expanded.has(node.path)) {
							setExpanded((prev) => new Set([...prev, node.path]));
						} else if (node.children.length > 0) {
							setFocusedPath(node.children[0]?.path ?? null);
						}
					}
					break;
				}
				case "ArrowLeft": {
					e.preventDefault();
					const node = visibleNodes[currentIndex];
					if (node?.type === "directory" && expanded.has(node.path)) {
						setExpanded((prev) => {
							const next = new Set(prev);
							next.delete(node.path);
							return next;
						});
					} else if (node) {
						const parentPath = node.path.includes("/")
							? node.path.substring(0, node.path.lastIndexOf("/"))
							: null;
						if (parentPath) {
							const parentNode = visibleNodes.find(
								(n) => n.path === parentPath || node.path.startsWith(`${n.path}/`)
							);
							if (parentNode) setFocusedPath(parentNode.path);
						}
					}
					break;
				}
				case "Enter": {
					e.preventDefault();
					const node = visibleNodes[currentIndex];
					if (node?.type === "directory") {
						setExpanded((prev) => {
							const next = new Set(prev);
							if (next.has(node.path)) next.delete(node.path);
							else next.add(node.path);
							return next;
						});
					} else if (node) {
						openFile(workspaceId, repoPath, node.path, detectLanguage(node.path));
					}
					break;
				}
				case "Delete":
				case "Backspace": {
					const node = visibleNodes[currentIndex];
					if (node && e.metaKey) {
						e.preventDefault();
						handleDelete(node);
					}
					break;
				}
				case "F2": {
					e.preventDefault();
					const node = visibleNodes[currentIndex];
					if (node) handleRename(node, 0);
					break;
				}
				case "Home": {
					e.preventDefault();
					const first = visibleNodes[0];
					if (first) setFocusedPath(first.path);
					break;
				}
				case "End": {
					e.preventDefault();
					const last = visibleNodes[visibleNodes.length - 1];
					if (last) setFocusedPath(last.path);
					break;
				}
			}
		},
		[visibleNodes, focusedPath, expanded, openFile, workspaceId, repoPath, inlineInput]
	);

	// ── File operation handlers ────────────────────────────────
	const handleDelete = useCallback(
		(node: TreeNode) => {
			const name = node.name;
			const isDir = node.type === "directory";
			const confirmed = window.confirm(
				`Delete ${isDir ? "folder" : "file"} "${name}"? This cannot be undone.`
			);
			if (confirmed) {
				deleteMutation.mutate({ repoPath, targetPath: node.path });
			}
		},
		[deleteMutation, repoPath]
	);

	const handleRename = useCallback((node: TreeNode, depth: number) => {
		setInlineInput({ type: "rename", node, depth });
	}, []);

	const handleInlineSubmit = useCallback(
		(value: string) => {
			if (!inlineInput) return;

			if (inlineInput.type === "new-file") {
				const filePath = inlineInput.parentPath ? `${inlineInput.parentPath}/${value}` : value;
				createFileMutation.mutate({ repoPath, filePath });
			} else if (inlineInput.type === "new-folder") {
				const dirPath = inlineInput.parentPath ? `${inlineInput.parentPath}/${value}` : value;
				createFolderMutation.mutate({ repoPath, dirPath });
				// Auto-expand the new folder
				setExpanded((prev) => new Set([...prev, dirPath]));
			} else if (inlineInput.type === "rename") {
				const oldPath = inlineInput.node.path;
				const parentDir = oldPath.includes("/")
					? oldPath.substring(0, oldPath.lastIndexOf("/"))
					: "";
				const newPath = parentDir ? `${parentDir}/${value}` : value;
				if (newPath !== oldPath) {
					renameMutation.mutate({ repoPath, oldPath, newPath });
				}
			}
			setInlineInput(null);
		},
		[inlineInput, repoPath, createFileMutation, createFolderMutation, renameMutation]
	);

	// ── Handlers ───────────────────────────────────────────────
	const handleToggle = useCallback((path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const handleFileSelect = useCallback(
		(node: TreeNode) => {
			openFile(workspaceId, repoPath, node.path, detectLanguage(node.path));
		},
		[openFile, workspaceId, repoPath]
	);

	const handleContextMenu = useCallback(
		(e: React.MouseEvent, node: TreeNode) => {
			const isDir = node.type === "directory";
			const absolutePath = `${repoPath}/${node.path}`;

			// Compute depth for inline input positioning
			const depth = node.path.split("/").length - 1;

			const items: ContextMenuItem[] = [
				{
					label: "New File",
					action: () => {
						const parentPath = isDir
							? node.path
							: node.path.includes("/")
								? node.path.substring(0, node.path.lastIndexOf("/"))
								: "";
						if (isDir) setExpanded((prev) => new Set([...prev, node.path]));
						setInlineInput({ type: "new-file", parentPath, depth: isDir ? depth + 1 : depth });
						setContextMenu(null);
					},
				},
				{
					label: "New Folder",
					action: () => {
						const parentPath = isDir
							? node.path
							: node.path.includes("/")
								? node.path.substring(0, node.path.lastIndexOf("/"))
								: "";
						if (isDir) setExpanded((prev) => new Set([...prev, node.path]));
						setInlineInput({ type: "new-folder", parentPath, depth: isDir ? depth + 1 : depth });
						setContextMenu(null);
					},
				},
				"separator",
				{
					label: "Rename",
					action: () => {
						setInlineInput({ type: "rename", node, depth });
						setContextMenu(null);
					},
				},
				{
					label: "Delete",
					action: () => {
						handleDelete(node);
						setContextMenu(null);
					},
				},
				"separator",
				{
					label: "Copy Path",
					action: () => {
						navigator.clipboard.writeText(absolutePath);
						setContextMenu(null);
					},
				},
				{
					label: "Copy Relative Path",
					action: () => {
						navigator.clipboard.writeText(node.path);
						setContextMenu(null);
					},
				},
				{
					label: "Reveal in Finder",
					action: () => {
						revealMutation.mutate({ absolutePath });
						setContextMenu(null);
					},
				},
			];

			setContextMenu({ x: e.clientX, y: e.clientY, node });
			// Store items on the context menu state
			contextMenuItemsRef.current = items;
		},
		[repoPath, handleDelete, revealMutation]
	);

	const contextMenuItemsRef = useRef<ContextMenuItem[]>([]);

	const handleExpandAll = useCallback(() => {
		const allDirs = new Set<string>();
		function collect(nodes: TreeNode[]) {
			for (const n of nodes) {
				if (n.type === "directory") {
					allDirs.add(n.path);
					collect(n.children);
				}
			}
		}
		collect(tree);
		setExpanded(allDirs);
	}, [tree]);

	const handleCollapseAll = useCallback(() => {
		setExpanded(new Set());
	}, []);

	const handleBreadcrumbClick = useCallback((segmentPath: string) => {
		const ancestors = getAncestorPaths(segmentPath);
		setExpanded((prev) => {
			const next = new Set(prev);
			for (const anc of ancestors) next.add(anc);
			next.add(segmentPath);
			return next;
		});
		requestAnimationFrame(() => {
			treeContainerRef.current
				?.querySelector(`[data-path="${CSS.escape(segmentPath)}"]`)
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		});
	}, []);

	const handleSearchNext = useCallback(() => {
		if (searchResults.length > 0) {
			setMatchIndex((i) => (i + 1) % searchResults.length);
		}
	}, [searchResults.length]);

	const handleSearchPrev = useCallback(() => {
		if (searchResults.length > 0) {
			setMatchIndex((i) => (i - 1 + searchResults.length) % searchResults.length);
		}
	}, [searchResults.length]);

	const handleRefresh = useCallback(() => {
		invalidateFiles();
	}, [invalidateFiles]);

	// ── Loading state ──────────────────────────────────────────
	if (filesQuery.isLoading) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex items-center justify-center py-8 text-[12px] text-[var(--text-quaternary)]">
					<svg
						aria-hidden="true"
						className="mr-2 size-4 animate-spin"
						viewBox="0 0 16 16"
						fill="none"
					>
						<circle
							cx="8"
							cy="8"
							r="6"
							stroke="var(--text-quaternary)"
							strokeWidth="1.5"
							strokeDasharray="28"
							strokeDashoffset="8"
							strokeLinecap="round"
						/>
					</svg>
					Loading files...
				</div>
			</div>
		);
	}

	if (allEntries.length === 0) {
		return (
			<div className="flex h-full items-center justify-center py-8 text-[12px] text-[var(--text-quaternary)]">
				Empty repository
			</div>
		);
	}

	// ── Render ──────────────────────────────────────────────────
	return (
		<div ref={panelRef} className="flex h-full flex-col overflow-hidden">
			<SearchBar
				query={searchQuery}
				onChange={setSearchQuery}
				matchCount={searchResults.length}
				matchIndex={searchResults.length > 0 ? matchIndex % searchResults.length : 0}
				onNext={handleSearchNext}
				onPrev={handleSearchPrev}
				inputRef={searchInputRef}
			/>

			{activeFilePath && (
				<BreadcrumbBar filePath={activeFilePath} onSegmentClick={handleBreadcrumbClick} />
			)}

			<Toolbar
				compact={compact}
				showHidden={showHidden}
				onToggleCompact={() => setCompact((c) => !c)}
				onToggleHidden={() => setShowHidden((h) => !h)}
				onExpandAll={handleExpandAll}
				onCollapseAll={handleCollapseAll}
				onRefresh={handleRefresh}
			/>

			{/* Tree */}
			<div
				ref={treeContainerRef}
				className="flex-1 overflow-y-auto px-1 py-1 outline-none"
				role="tree"
				tabIndex={0}
				onKeyDown={handleTreeKeyDown}
				onFocus={() => {
					if (!focusedPath && visibleNodes.length > 0) {
						setFocusedPath(visibleNodes[0]?.path ?? null);
					}
				}}
				onContextMenu={(e) => {
					// Only handle right-click on empty space (not bubbled from a tree node)
					if (e.target === e.currentTarget || !(e.target as HTMLElement).closest("[data-path]")) {
						e.preventDefault();
						const items: ContextMenuItem[] = [
							{
								label: "New File",
								action: () => {
									setInlineInput({ type: "new-file", parentPath: "", depth: 0 });
									setContextMenu(null);
								},
							},
							{
								label: "New Folder",
								action: () => {
									setInlineInput({ type: "new-folder", parentPath: "", depth: 0 });
									setContextMenu(null);
								},
							},
						];
						setContextMenu({ x: e.clientX, y: e.clientY });
						contextMenuItemsRef.current = items;
					}
				}}
			>
				{/* Inline input at root level */}
				{inlineInput &&
					(inlineInput.type === "new-file" || inlineInput.type === "new-folder") &&
					inlineInput.parentPath === "" && (
						<InlineInput
							defaultValue={inlineInput.type === "new-file" ? "untitled" : "new-folder"}
							onSubmit={handleInlineSubmit}
							onCancel={() => setInlineInput(null)}
							depth={0}
						/>
					)}

				<TreeBranch
					nodes={tree}
					depth={0}
					expanded={expanded}
					onToggle={handleToggle}
					onFileSelect={handleFileSelect}
					onContextMenu={handleContextMenu}
					activeFilePath={activeFilePath}
					focusedPath={focusedPath}
					searchMatchPaths={searchMatchPaths}
					searchMatchIndicesMap={searchMatchIndicesMap}
					gitStatusMap={gitStatusMap}
					inlineInput={inlineInput}
					onInlineSubmit={handleInlineSubmit}
					onInlineCancel={() => setInlineInput(null)}
				/>
			</div>

			{/* Context menu */}
			{contextMenu && (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					items={contextMenuItemsRef.current}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	);
}
