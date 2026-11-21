import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { UnifiedThread } from "../../../../shared/github-types";
import {
	type RailFileItem,
	countsByPath,
	railItems,
	resolveRailMode,
	viewedProgress,
} from "../../../lib/review-path-model";
import type { ReviewPathSource } from "../../../lib/review-path-source";
import { useReviewPathSettingsStore } from "../../../stores/review-path-settings-store";
import { FilesRail } from "./FilesRail";
import { MapPathCard } from "./MapPathCard";
import { PathRail } from "./PathRail";
import { RailHeader } from "./RailHeader";

export interface ReviewRailProps {
	source: ReviewPathSource;
	files: { path: string }[];
	threads: UnifiedThread[];
	viewed: ReadonlySet<string>;
	selectedPath: string | null;
	mode: "path" | "files" | null;
	onModeChange: (mode: "path" | "files") => void;
	onSelect: (item: RailFileItem) => void;
	collapsed?: boolean;
	showViewed?: boolean;
}
const clamp = (width: number) => Math.min(360, Math.max(240, width));

export function ReviewRail({
	source,
	files,
	threads,
	viewed,
	selectedPath,
	mode: override,
	onModeChange,
	onSelect,
	collapsed = false,
	showViewed = true,
}: ReviewRailProps) {
	const defaultMode = useReviewPathSettingsStore((state) => state.defaultRailMode);
	const mode = resolveRailMode(override, defaultMode, source.status);
	const items = useMemo(() => railItems(source.path, files, mode), [source.path, files, mode]);
	const counts = useMemo(() => countsByPath(threads), [threads]);
	const testCounts = useMemo(
		() =>
			new Map(
				source.path?.entries.flatMap((entry) =>
					entry.steps.flatMap((step) =>
						step.kind === "changed" ? [[step.path, step.tests.length] as const] : []
					)
				) ?? []
			),
		[source.path]
	);
	const [width, setWidth] = useState(288);
	const navRef = useRef<HTMLElement>(null);
	const cleanupResize = useRef<(() => void) | null>(null);
	useEffect(() => () => cleanupResize.current?.(), []);
	function startResize(event: ReactPointerEvent<HTMLDivElement>) {
		event.preventDefault();
		cleanupResize.current?.();
		const startX = event.clientX;
		let latest = width;
		let frame = 0;
		const move = (event: PointerEvent) => {
			latest = clamp(width + event.clientX - startX);
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					if (navRef.current) navRef.current.style.width = `${latest}px`;
				});
		};
		const cleanup = () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", finish);
			window.removeEventListener("pointercancel", finish);
		};
		const finish = () => {
			cleanup();
			cleanupResize.current = null;
			setWidth(latest);
		};
		cleanupResize.current = cleanup;
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", finish);
		window.addEventListener("pointercancel", finish);
	}
	if (collapsed) return null;
	const listProps = {
		items,
		selectedPath,
		viewed,
		showViewed,
		counts,
		onSelect,
		virtualize: files.length > 100,
	};
	return (
		<nav
			ref={navRef}
			aria-label={mode === "path" ? "Reading path" : "Changed files"}
			style={{ width }}
			className="relative flex min-h-0 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
		>
			<RailHeader
				mode={mode}
				onModeChange={onModeChange}
				source={source}
				progress={viewedProgress(files, viewed)}
				showViewed={showViewed}
			/>
			{(source.status === "none" || source.status === "failed") && <MapPathCard source={source} />}
			{mode === "path" ? (
				<PathRail {...listProps} mapping={source.status === "mapping"} />
			) : (
				<FilesRail {...listProps} testCounts={testCounts} />
			)}
			<div
				role="separator"
				tabIndex={0}
				aria-label="Resize review rail"
				aria-orientation="vertical"
				aria-valuenow={width}
				aria-valuemin={240}
				aria-valuemax={360}
				onPointerDown={startResize}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
						event.preventDefault();
						setWidth((value) => clamp(value + (event.key === "ArrowLeft" ? -20 : 20)));
					}
				}}
				className="absolute bottom-0 right-0 top-0 w-1 cursor-col-resize outline-none focus-visible:bg-[var(--border-active)] hover:bg-[var(--border-active)]"
			/>
		</nav>
	);
}
