import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RailFileItem, RailItem } from "../../../lib/review-path-model";
import { ArrowRightToLine } from "./RailIcons";
import { ContextRow, FileRow, StepRow, TestRow } from "./RailRows";

export interface RailListProps {
	items: RailItem[];
	selectedPath: string | null;
	viewed: ReadonlySet<string>;
	showViewed?: boolean;
	counts: Map<string, { openThreads: number; pendingFindings: number }>;
	testCounts?: Map<string, number>;
	onSelect: (item: RailFileItem) => void;
	virtualize?: boolean;
	children?: ReactNode;
}
function rowHeight(item: RailItem) {
	if ("folderLabel" in item && item.folderLabel) return 46;
	return item.kind === "test"
		? 26
		: item.kind === "context"
			? 32
			: item.kind === "entry"
				? 40
				: item.kind === "folder"
					? 30
					: 34;
}

/** Window the model's ordered list; selection scrolling never changes selection or focus. */
export function RailList({
	items,
	selectedPath,
	viewed,
	showViewed,
	counts,
	testCounts,
	onSelect,
	virtualize = false,
	children,
}: RailListProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [viewport, setViewport] = useState({ top: 0, height: 640 });
	const layout = useMemo(() => {
		let top = 0;
		return items.map((item) => {
			const row = { item, top, height: rowHeight(item) };
			top += row.height;
			return row;
		});
	}, [items]);
	const total = layout.length ? (layout.at(-1)?.top ?? 0) + (layout.at(-1)?.height ?? 0) : 0;
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const update = () => setViewport((state) => ({ ...state, height: node.clientHeight || 640 }));
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node || !selectedPath) return;
		const row = layout.find((row) => "path" in row.item && row.item.path === selectedPath);
		if (!row) return;
		const height = node.clientHeight || 640;
		if (row.top < node.scrollTop) node.scrollTop = row.top;
		else if (row.top + row.height > node.scrollTop + height)
			node.scrollTop = row.top + row.height - height;
		setViewport({ top: node.scrollTop, height });
	}, [selectedPath, layout]);
	const visible = virtualize
		? layout.filter(
				(row) =>
					row.top + row.height >= viewport.top - 160 &&
					row.top <= viewport.top + viewport.height + 160
			)
		: layout;
	return (
		<div
			ref={ref}
			data-rail-scroll
			className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
			onScroll={(event) =>
				setViewport({
					top: event.currentTarget.scrollTop,
					height: event.currentTarget.clientHeight || 640,
				})
			}
		>
			<div className="relative" style={virtualize ? { height: total } : undefined}>
				{visible.map(({ item, top, height }) => (
					<div
						key={item.id}
						style={virtualize ? { position: "absolute", top, height, width: "100%" } : undefined}
					>
						{item.kind === "entry" ? (
							<div className="flex h-10 items-center gap-2 px-4 pt-2 text-[12px] font-semibold text-[var(--text)]">
								<ArrowRightToLine
									size={14}
									className="shrink-0 text-[var(--text-tertiary)]"
									aria-hidden="true"
								/>
								<span className="truncate">{item.title}</span>
							</div>
						) : item.kind === "folder" ? (
							<div
								data-folder={item.title}
								title={item.title || "Repository root"}
								className="flex h-[30px] items-end truncate px-4 pb-1 font-mono text-[11px] text-[var(--text-tertiary)]"
							>
								{item.title || "Repository root"}
							</div>
						) : "path" in item ? (
							<div className="relative">
								{item.entryId && (
									<span
										aria-hidden="true"
										className="absolute bottom-0 left-[26px] top-0 w-px bg-[var(--bg-overlay)]"
									/>
								)}
								{(() => {
									const Row =
										item.kind === "step"
											? StepRow
											: item.kind === "test"
												? TestRow
												: item.kind === "context"
													? ContextRow
													: FileRow;
									return (
										<Row
											item={item}
											selected={item.path === selectedPath}
											viewed={viewed.has(item.path)}
											showViewed={showViewed}
											counts={counts.get(item.path)}
											testCount={testCounts?.get(item.path)}
											onSelect={onSelect}
										/>
									);
								})()}
							</div>
						) : null}
					</div>
				))}
			</div>
			{children}
		</div>
	);
}
