import type { ReactNode } from "react";
import type { RailFileItem } from "../../../lib/review-path-model";
import { Check, Circle, FlaskConical, MessageSquare, Sparkles } from "./RailIcons";

export interface RailRowProps {
	item: RailFileItem;
	selected: boolean;
	viewed: boolean;
	showViewed?: boolean;
	counts?: { openThreads: number; pendingFindings: number };
	testCount?: number;
	onSelect: (item: RailFileItem) => void;
}

function Counts({ counts, testCount }: Pick<RailRowProps, "counts" | "testCount">) {
	return (
		<span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
			{!!testCount && (
				<span
					aria-label={`${testCount} ${testCount === 1 ? "test" : "tests"}`}
					className="flex items-center gap-0.5"
				>
					<FlaskConical size={12} aria-hidden="true" />
					{testCount}
				</span>
			)}
			{!!counts?.openThreads && (
				<span
					aria-label={`${counts.openThreads} open ${counts.openThreads === 1 ? "thread" : "threads"}`}
					className="flex items-center gap-0.5"
				>
					<MessageSquare size={12} aria-hidden="true" />
					{counts.openThreads}
				</span>
			)}
			{!!counts?.pendingFindings && (
				<span
					aria-label={`${counts.pendingFindings} pending ${counts.pendingFindings === 1 ? "finding" : "findings"}`}
					className="flex items-center gap-0.5 rounded-full bg-[var(--tag-amber-bg)] px-1.5 text-[var(--tag-amber-fg)]"
				>
					<Sparkles size={10} aria-hidden="true" />
					{counts.pendingFindings}
				</span>
			)}
		</span>
	);
}

function Row({
	item,
	selected,
	onSelect,
	children,
	indent = false,
	...props
}: RailRowProps & { children: ReactNode; indent?: boolean }) {
	return (
		<button
			type="button"
			title={item.path}
			data-rail-kind={item.kind}
			data-path={item.path}
			data-step-number={item.number}
			aria-current={selected ? "step" : undefined}
			onClick={() => onSelect(item)}
			className={`relative flex w-full items-center gap-[10px] pr-[14px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${indent ? "h-[26px] pl-[46px] text-[12px]" : item.kind === "context" ? "h-[32px] pl-[16px] text-[13px]" : "h-[34px] pl-[16px] text-[13px]"} ${selected ? "bg-[var(--bg-overlay)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
		>
			{children}
			<span className="min-w-0 flex-1 truncate">{item.path.split("/").pop()}</span>
			{item.folderLabel && (
				<span className="max-w-[90px] truncate text-[11px] text-[var(--text-tertiary)]">
					{item.folderLabel}
				</span>
			)}
			{item.kind === "context" ? (
				<span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
					{item.step?.kind === "context" && item.step.addedBy === "user"
						? "added by you"
						: "context · agent"}
				</span>
			) : (
				<Counts {...props} />
			)}
		</button>
	);
}

export function StepRow(props: RailRowProps) {
	const viewed = props.showViewed !== false && props.viewed && props.item.changed;
	return (
		<Row {...props}>
			<span
				aria-label={viewed ? "Viewed" : `Step ${props.item.number}`}
				className={`relative z-[1] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${viewed ? "bg-[var(--success-subtle)] text-[var(--color-success)]" : props.selected ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "border-[1.5px] border-[var(--text-tertiary)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"}`}
			>
				{viewed ? <Check size={12} aria-hidden="true" /> : props.item.number}
			</span>
		</Row>
	);
}
export function TestRow(props: RailRowProps) {
	const viewed = props.showViewed !== false && props.viewed && props.item.changed;
	return (
		<Row {...props} indent>
			<span
				aria-label={viewed ? "Viewed" : props.item.changed ? "Test" : "Test, not changed"}
				className={viewed ? "text-[var(--color-success)]" : "text-[var(--text-tertiary)]"}
			>
				{viewed ? (
					<Check size={12} aria-hidden="true" />
				) : (
					<FlaskConical size={12} aria-hidden="true" />
				)}
			</span>
		</Row>
	);
}
export function ContextRow(props: RailRowProps) {
	return (
		<Row {...props}>
			<span
				aria-label="Context, not changed"
				className="relative z-[1] h-[20px] w-[20px] shrink-0 rounded-full border-[1.5px] border-dotted border-[var(--text-tertiary)] bg-[var(--bg-surface)]"
			/>
		</Row>
	);
}
export function FileRow(props: RailRowProps) {
	const viewed = props.showViewed !== false && props.viewed && props.item.changed;
	return (
		<Row {...props}>
			<span
				aria-label={!props.item.changed ? "Not changed" : viewed ? "Viewed" : "Not viewed"}
				className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center ${viewed ? "text-[var(--color-success)]" : "text-[var(--text-tertiary)]"}`}
			>
				{viewed ? <Check size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
			</span>
		</Row>
	);
}
export function SkeletonRow() {
	return (
		<div aria-label="Mapping next step" className="flex h-[34px] items-center gap-[10px] pl-[16px]">
			<span className="h-[20px] w-[20px] rounded-full border border-dashed border-[var(--text-tertiary)]" />
			<span className="h-2 w-28 rounded bg-[var(--bg-overlay)] motion-safe:animate-pulse" />
		</div>
	);
}
