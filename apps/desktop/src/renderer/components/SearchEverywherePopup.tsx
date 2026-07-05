import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { detectLanguage } from "../../shared/diff-types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
	SEARCH_TABS,
	type SearchTab,
	useSearchEverywhereStore,
} from "../stores/search-everywhere-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { fuzzyFilterPaths } from "../utils/fuzzy-match";
import { mergeAllResults } from "../utils/merge-all-results";
import { type ResultItem, resultKey } from "../utils/search-everywhere-results";

export { resultKey };
export type { ResultItem };

const TAB_LABELS: Record<SearchTab, string> = {
	all: "All",
	files: "Files",
	symbols: "Symbols",
	text: "Text",
};

export const SYMBOL_KIND_GLYPHS: Readonly<Partial<Record<number, string>>> = {
	5: "C", // Class
	6: "M", // Method
	9: "⊕", // Constructor
	10: "E", // Enum
	11: "I", // Interface
	12: "F", // Function
	13: "V", // Variable
	14: "K", // Constant
	23: "S", // Struct
};

export function symbolKindGlyph(kind: number): string {
	return SYMBOL_KIND_GLYPHS[kind] ?? "•";
}

export function getSearchEverywhereEmptyStateMessage({
	activeTab,
	trimmedQuery,
	queryMatchesInput,
	isError = false,
	isFetching = false,
	serversQueried,
}: {
	activeTab: SearchTab;
	trimmedQuery: string;
	queryMatchesInput: boolean;
	isError?: boolean;
	isFetching?: boolean;
	serversQueried?: number;
}): string {
	if (trimmedQuery.length === 0) return "Type to search";
	if (activeTab === "text") {
		if (trimmedQuery.length < 2) return "Type at least 2 characters";
		if (!queryMatchesInput) return "Searching...";
		if (isError) return "Search failed";
		if (isFetching) return "Searching...";
	}
	if (activeTab === "symbols") {
		if (trimmedQuery.length < 2) return "Type at least 2 characters";
		if (!queryMatchesInput) return "Searching...";
		if (isError) return "Search failed";
		if (isFetching) return "Searching...";
		if (serversQueried === 0)
			return "No language servers running — symbols appear once files are opened in the editor";
	}
	return "No results";
}

function resultPath(item: ResultItem): string {
	return item.type === "text" || item.type === "symbol" ? `${item.path}:${item.line}` : item.path;
}

export function SearchEverywherePopup() {
	const isOpen = useSearchEverywhereStore((s) => s.isOpen);
	const close = useSearchEverywhereStore((s) => s.close);
	const activeTab = useSearchEverywhereStore((s) => s.activeTab);
	const setActiveTab = useSearchEverywhereStore((s) => s.setActiveTab);
	const cycleTab = useSearchEverywhereStore((s) => s.cycleTab);

	const workspaceId = useTabStore((s) => s.activeWorkspaceId);
	const repoPath = useTabStore((s) => s.activeWorkspaceCwd);
	const openFile = useTabStore((s) => s.openFile);
	const filesQuery = trpc.diff.listAllFiles.useQuery(
		{ repoPath },
		{ enabled: isOpen && repoPath.length > 0, staleTime: 60_000 }
	);

	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (isOpen) {
			setQuery("");
			setSelectedIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [isOpen]);

	useEffect(() => {
		if (isOpen && workspaceId === null) close();
	}, [isOpen, workspaceId, close]);

	const filePaths = useMemo(
		() =>
			(filesQuery.data?.entries ?? [])
				.filter((entry) => entry.type === "file")
				.map((entry) => entry.path),
		[filesQuery.data]
	);
	const trimmedQuery = query.trim();
	const debouncedQuery = useDebouncedValue(trimmedQuery, 200);
	const textQueryMatchesInput = debouncedQuery === trimmedQuery;
	const canShowTextQueryState =
		activeTab === "text" && textQueryMatchesInput && trimmedQuery.length >= 2;
	const textEnabled = isOpen && activeTab === "text" && debouncedQuery.length >= 2;
	const textQuery = trpc.diff.searchText.useQuery(
		{ repoPath, query: debouncedQuery },
		{ enabled: textEnabled && repoPath.length > 0, staleTime: 10_000 }
	);
	const symbolsQueryMatchesInput = debouncedQuery === trimmedQuery;
	const canShowSymbolQueryState =
		activeTab === "symbols" && symbolsQueryMatchesInput && trimmedQuery.length >= 2;
	const canShowAllSymbolResults = symbolsQueryMatchesInput && trimmedQuery.length >= 2;
	const symbolsEnabled =
		isOpen && (activeTab === "symbols" || activeTab === "all") && debouncedQuery.length >= 2;
	const symbolsQuery = trpc.lsp.searchWorkspaceSymbols.useQuery(
		{ repoPath, query: debouncedQuery },
		{ enabled: symbolsEnabled && repoPath.length > 0, staleTime: 10_000 }
	);

	const symbolHits: ResultItem[] = useMemo(
		() =>
			(symbolsQuery.data?.symbols ?? []).map((s) => ({
				type: "symbol" as const,
				name: s.name,
				kind: s.kind,
				path: s.path,
				line: s.line,
				column: s.column,
				container: s.container,
			})),
		[symbolsQuery.data]
	);

	const results: ResultItem[] = useMemo(() => {
		if (activeTab === "files") {
			if (trimmedQuery.length === 0) return [];
			return fuzzyFilterPaths(trimmedQuery, filePaths, 50).map((path) => ({
				type: "file" as const,
				path,
			}));
		}
		if (activeTab === "all") {
			if (trimmedQuery.length === 0) return [];
			const fileItems = filePaths.map((path) => ({
				type: "file" as const,
				path,
			}));
			const symbolItems = canShowAllSymbolResults
				? symbolHits.filter(
						(symbol): symbol is Extract<ResultItem, { type: "symbol" }> => symbol.type === "symbol"
					)
				: [];
			return mergeAllResults(trimmedQuery, fileItems, symbolItems, 50);
		}
		if (activeTab === "text") {
			if (!canShowTextQueryState) return [];
			return (textQuery.data?.matches ?? []).map((match) => ({
				type: "text" as const,
				path: match.path,
				line: match.line,
				text: match.text,
			}));
		}
		if (activeTab === "symbols") {
			if (!canShowSymbolQueryState) return [];
			return symbolHits;
		}
		return [];
	}, [
		activeTab,
		trimmedQuery,
		filePaths,
		canShowAllSymbolResults,
		symbolHits,
		canShowTextQueryState,
		textQuery.data,
		canShowSymbolQueryState,
	]);

	useEffect(() => {
		if (selectedIndex >= results.length) {
			setSelectedIndex(Math.max(0, results.length - 1));
		}
	}, [results.length, selectedIndex]);

	useEffect(() => {
		if (results.length === 0) return;
		const selected = listRef.current?.querySelector(`[data-result-index="${selectedIndex}"]`);
		selected?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex, results.length]);

	function openResult(item: ResultItem) {
		if (workspaceId === null || repoPath.length === 0) return;
		close();
		if (item.type === "file") {
			openFile(workspaceId, repoPath, item.path, detectLanguage(item.path));
			return;
		}

		openFile(workspaceId, repoPath, item.path, detectLanguage(item.path), {
			lineNumber: item.line,
			column: item.type === "symbol" ? item.column : 1,
		});
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Tab") {
			e.preventDefault();
			cycleTab(e.shiftKey ? -1 : 1);
			setSelectedIndex(0);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const item = results[selectedIndex];
			if (item) openResult(item);
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	}

	if (!isOpen) return null;

	const selected = results[selectedIndex];
	function emptyStateMessage(): string {
		if (activeTab === "text") {
			return getSearchEverywhereEmptyStateMessage({
				activeTab,
				trimmedQuery,
				queryMatchesInput: textQueryMatchesInput,
				isError: textQuery.isError,
				isFetching: textQuery.isFetching,
			});
		}
		if (activeTab === "symbols") {
			return getSearchEverywhereEmptyStateMessage({
				activeTab,
				trimmedQuery,
				queryMatchesInput: symbolsQueryMatchesInput,
				isError: symbolsQuery.isError,
				isFetching: symbolsQuery.isFetching,
				serversQueried: symbolsQuery.data?.serversQueried,
			});
		}
		return getSearchEverywhereEmptyStateMessage({
			activeTab,
			trimmedQuery,
			queryMatchesInput: true,
		});
	}

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]"
			onClick={(e) => {
				if (e.target === e.currentTarget) close();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<button
				type="button"
				className="fixed inset-0 cursor-default border-0 bg-[var(--scrim)] p-0"
				aria-label="Close Search Everywhere"
				onClick={close}
			/>

			<div className="relative z-10 flex w-[640px] max-h-[60vh] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)] backdrop-blur-md">
				<div className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-3 pt-2">
					{SEARCH_TABS.map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => {
								setActiveTab(tab);
								setSelectedIndex(0);
								inputRef.current?.focus();
							}}
							className={`rounded-t-[4px] border-b-2 px-3 py-1.5 text-[12px] transition-colors ${
								activeTab === tab
									? "border-[var(--accent)] text-[var(--text)]"
									: "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
							}`}
						>
							{TAB_LABELS[tab]}
						</button>
					))}
				</div>

				<div className="flex items-center border-b border-[var(--border-subtle)] px-4 py-3">
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						className="mr-3 shrink-0 text-[var(--text-quaternary)]"
						aria-hidden="true"
					>
						<circle cx="7" cy="7" r="5" />
						<path d="M11 11l3.5 3.5" strokeLinecap="round" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelectedIndex(0);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Search files, symbols, text..."
						className="flex-1 bg-transparent text-[14px] text-[var(--text)] placeholder-[var(--text-quaternary)] outline-none"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>

				<div ref={listRef} className="min-h-[120px] overflow-y-auto py-2">
					{results.length === 0 && (
						<div className="px-4 py-6 text-center text-[13px] text-[var(--text-quaternary)]">
							{emptyStateMessage()}
						</div>
					)}
					{canShowTextQueryState && textQuery.data?.truncated && (
						<div className="px-4 pb-1 text-center text-[11px] text-[var(--text-quaternary)]">
							Showing first {results.length} matches
						</div>
					)}
					{results.map((item, i) => (
						<ResultRow
							key={resultKey(item)}
							item={item}
							index={i}
							isSelected={i === selectedIndex}
							onSelect={() => openResult(item)}
							onHover={() => setSelectedIndex(i)}
						/>
					))}
				</div>

				<div className="truncate border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--text-quaternary)]">
					{selected ? resultPath(selected) : " "}
				</div>
			</div>
		</div>,
		document.body
	);
}

function ResultRow({
	item,
	index,
	isSelected,
	onSelect,
	onHover,
}: {
	item: ResultItem;
	index: number;
	isSelected: boolean;
	onSelect: () => void;
	onHover: () => void;
}) {
	let primary: string;
	let secondary: string;
	if (item.type === "file") {
		const slash = item.path.lastIndexOf("/");
		primary = slash === -1 ? item.path : item.path.slice(slash + 1);
		secondary = slash === -1 ? "" : item.path.slice(0, slash);
	} else if (item.type === "symbol") {
		primary = item.name;
		secondary = `${item.container ? `${item.container} - ` : ""}${item.path}:${item.line}`;
	} else {
		primary = item.text.trim();
		secondary = `${item.path}:${item.line}`;
	}

	return (
		<button
			type="button"
			data-result-index={index}
			data-selected={isSelected}
			onClick={onSelect}
			onMouseEnter={onHover}
			className={`mx-2 flex w-[calc(100%-1rem)] cursor-pointer items-center gap-3 rounded-[6px] border-0 px-3 py-1.5 text-left font-sans text-[13px] transition-colors ${
				isSelected
					? "bg-[var(--bg-elevated)] text-[var(--text)]"
					: "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
			}`}
		>
			{item.type === "symbol" && (
				<span
					aria-hidden="true"
					className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-[var(--bg-base)] text-[10px] text-[var(--text-tertiary)]"
				>
					{symbolKindGlyph(item.kind)}
				</span>
			)}
			<span className="min-w-0 truncate font-medium">{primary}</span>
			<span className="min-w-0 flex-1 truncate text-right text-[11px] text-[var(--text-quaternary)]">
				{secondary}
			</span>
		</button>
	);
}
