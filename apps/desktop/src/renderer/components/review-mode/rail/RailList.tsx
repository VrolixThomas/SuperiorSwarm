import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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

/** Measure natural wrapping height; virtual rows cannot use a fixed single-line slot. */
function MeasuredRow({
	id,
	width,
	onMeasure,
	style,
	children,
}: {
	id: string;
	width: number;
	onMeasure: (id: string, height: number) => void;
	style?: CSSProperties;
	children: ReactNode;
}) {
	const row = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: width changes invalidate measurements, including rows whose height stays the same.
	useLayoutEffect(() => {
		const node = row.current;
		if (!node) return;
		const measure = () => {
			const height = node.getBoundingClientRect().height;
			if (height > 0) onMeasure(id, height);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [id, onMeasure, width]);
	return (
		<div ref={row} data-rail-row={id} style={style}>
			{children}
		</div>
	);
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
	const [viewport, setViewport] = useState({ top: 0, height: 640, width: 0 });
	const [heights, setHeights] = useState<Record<string, number>>({});
	const measuredWidth = useRef(0);
	const lastSelection = useRef<string | null>(null);
	const pendingSelection = useRef(false);
	const measure = useCallback(
		(id: string, height: number) =>
			setHeights((previous) =>
				Math.abs((previous[id] ?? 0) - height) < 0.5 ? previous : { ...previous, [id]: height }
			),
		[]
	);
	const layout = useMemo(() => {
		let top = 0;
		return items.map((item) => {
			const row = { item, top, height: heights[item.id] ?? rowHeight(item) };
			top += row.height;
			return row;
		});
	}, [items, heights]);
	const total = layout.length ? (layout.at(-1)?.top ?? 0) + (layout.at(-1)?.height ?? 0) : 0;
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const update = () => {
			const width = node.clientWidth;
			if (measuredWidth.current !== width) {
				measuredWidth.current = width;
				setHeights({});
			}
			setViewport((state) => ({ ...state, height: node.clientHeight || 640, width }));
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useLayoutEffect(() => {
		const node = ref.current;
		if (lastSelection.current !== selectedPath) {
			lastSelection.current = selectedPath;
			pendingSelection.current = !!selectedPath;
		}
		if (!node || !selectedPath || !pendingSelection.current) return;
		const row = layout.find((row) => "path" in row.item && row.item.path === selectedPath);
		if (!row) return;
		const height = node.clientHeight || 640;
		const element = virtualize
			? undefined
			: [...node.querySelectorAll<HTMLElement>("[data-rail-row]")].find(
					(element) => element.dataset["railRow"] === row.item.id
				);
		const top = element?.offsetTop ?? row.top;
		const measuredHeight = element?.offsetHeight || row.height;
		if (top < node.scrollTop) node.scrollTop = top;
		else if (top + measuredHeight > node.scrollTop + height)
			node.scrollTop = top + measuredHeight - height;
		setViewport((state) => ({ ...state, top: node.scrollTop, height }));
		if (!virtualize || heights[row.item.id] !== undefined) pendingSelection.current = false;
	}, [selectedPath, layout, virtualize, heights]);
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
					width: event.currentTarget.clientWidth,
				})
			}
		>
			<div className="relative" style={virtualize ? { height: total } : undefined}>
				{visible.map(({ item, top }) => (
					<MeasuredRow
						key={item.id}
						id={item.id}
						width={viewport.width}
						onMeasure={measure}
						style={virtualize ? { position: "absolute", top, width: "100%" } : undefined}
					>
						{item.kind === "entry" ? (
							<div
								title={item.title}
								className="flex min-h-10 items-start gap-2 px-4 py-2 text-[12px] font-semibold text-[var(--text)]"
							>
								<ArrowRightToLine
									size={14}
									className="shrink-0 text-[var(--text-tertiary)]"
									aria-hidden="true"
								/>
								<span
									data-rail-entry-title
									className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] leading-[18px]"
								>
									{item.title}
								</span>
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
					</MeasuredRow>
				))}
			</div>
			{children}
		</div>
	);
}
