// Mirrors apps/desktop/src/renderer/components/solve/SolveDiffPane.tsx. Static (no monaco, no tRPC, no stores) — diff rendered as plain row list.

import type { SolveSessionInfo } from "./SolveReviewTab";

interface Props {
	session: SolveSessionInfo;
	activeFilePath: string;
}

interface DiffLine {
	kind: "del" | "add" | "ctx";
	lineNo: number | null;
	text: string;
}

const DIFF_LINES: DiffLine[] = [
	{ kind: "ctx", lineNo: 38, text: "  const streamRef = useRef<Subscription | null>(null);" },
	{ kind: "ctx", lineNo: 39, text: "" },
	{ kind: "ctx", lineNo: 40, text: "  useEffect(() => {" },
	{ kind: "ctx", lineNo: 41, text: "    if (!sessionId) return;" },
	{ kind: "del", lineNo: 42, text: "    streamRef.current = stream.subscribe(handler);" },
	{ kind: "add", lineNo: 42, text: "    const sub = stream.subscribe(handler);" },
	{ kind: "add", lineNo: 43, text: "    return () => sub.unsubscribe();" },
	{ kind: "ctx", lineNo: 44, text: "  }, [sessionId]);" },
	{ kind: "ctx", lineNo: 45, text: "" },
	{ kind: "ctx", lineNo: 46, text: "  const send = useCallback((msg: string) => {" },
	{ kind: "ctx", lineNo: 47, text: "    if (!streamRef.current) return;" },
	{ kind: "ctx", lineNo: 48, text: "    streamRef.current.send(msg);" },
	{ kind: "ctx", lineNo: 49, text: "  }, []);" },
	{ kind: "ctx", lineNo: 50, text: "" },
	{ kind: "ctx", lineNo: 51, text: "  return { send };" },
	{ kind: "ctx", lineNo: 52, text: "}" },
];

const EMPTY_LINE_NOS: number[] = [];

interface Hint {
	keys: string[];
	label: string;
}

const SOLVE_HINTS: Hint[] = [
	{ keys: ["J", "K"], label: "File" },
	{ keys: ["⇧J", "⇧K"], label: "Group" },
	{ keys: ["A"], label: "Approve" },
	{ keys: ["P"], label: "Push" },
];

export function SolveDiffPane({ session, activeFilePath }: Props) {
	const selectedGroup = session.groups.find((g) =>
		g.changedFiles.some((f) => f.path === activeFilePath)
	);
	const commitHash = selectedGroup?.commitHash ?? null;
	const shortHash = commitHash ? commitHash.slice(0, 7) : "no commit";
	const leftSideCount: number = 0;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{activeFilePath}
				</span>
				<span className="font-mono text-[11px] text-[var(--text-quaternary)]">{shortHash}</span>
				<button
					type="button"
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					title="Hide inline comments"
				>
					💬 Comments: On
				</button>
				<button
					type="button"
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					Split
				</button>
			</div>
			{leftSideCount > 0 && (
				<div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[11px] text-[var(--text-secondary)]">
					<span>ⓘ</span>
					<span>
						{leftSideCount} {leftSideCount === 1 ? "comment is" : "comments are"} on deleted lines
					</span>
					<button
						type="button"
						className="text-[var(--accent)] hover:underline cursor-pointer bg-transparent border-none p-0"
					>
						Switch to Split view
					</button>
				</div>
			)}
			<div className="flex-1 overflow-hidden">
				<DiffBody />
			</div>
			<ReviewHintBar hints={SOLVE_HINTS} />
		</div>
	);
}

function DiffBody() {
	return (
		<div className="h-full overflow-y-auto font-mono text-[12px] leading-[1.5] bg-[var(--bg-base)]">
			{DIFF_LINES.map((line, idx) => {
				const key = `${idx}-${line.kind}`;
				const isDel = line.kind === "del";
				const isAdd = line.kind === "add";
				const rowBg = isDel
					? "bg-[var(--danger-subtle)]"
					: isAdd
						? "bg-[var(--success-subtle)]"
						: "";
				const sigil = isDel ? "-" : isAdd ? "+" : " ";
				const sigilColor = isDel
					? "text-[var(--danger)]"
					: isAdd
						? "text-[var(--success)]"
						: "text-[var(--text-tertiary)]";
				return (
					<div key={key} className={`flex items-stretch ${rowBg}`}>
						<span className="shrink-0 w-[44px] text-right pr-[10px] py-[1px] text-[var(--text-quaternary)] select-none">
							{line.lineNo ?? ""}
						</span>
						<span className={`shrink-0 w-[16px] text-center py-[1px] ${sigilColor} select-none`}>
							{sigil}
						</span>
						<span className="flex-1 pr-3 py-[1px] whitespace-pre text-[var(--text)] overflow-hidden">
							{line.text}
						</span>
					</div>
				);
			})}
			{EMPTY_LINE_NOS.map((n) => (
				<div key={`empty-${n}`} className="flex items-stretch">
					<span className="shrink-0 w-[44px] text-right pr-[10px] py-[1px] text-[var(--text-quaternary)] select-none">
						{n}
					</span>
					<span className="shrink-0 w-[16px] text-center py-[1px] text-[var(--text-tertiary)] select-none">
						{" "}
					</span>
					<span className="flex-1 pr-3 py-[1px] whitespace-pre text-[var(--text)]" />
				</div>
			))}
		</div>
	);
}

function ReviewHintBar({ hints }: { hints: Hint[] }) {
	return (
		<div className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-[10.5px] text-[var(--text-tertiary)]">
			{hints.map((hint, idx) => (
				<div key={`${idx}-${hint.label}`} className="flex items-center gap-[5px]">
					{hint.keys.map((k) => (
						<kbd
							key={k}
							className="font-mono text-[10px] px-[5px] py-[1px] rounded-[3px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
						>
							{k}
						</kbd>
					))}
					<span>{hint.label}</span>
				</div>
			))}
		</div>
	);
}
