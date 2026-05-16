// Mirrors apps/desktop/src/renderer/components/review/ReviewTab.tsx structure:
// ReviewFilterTabs (All/Working/Branch) → progress bar + Split/Unified pill →
// file path strip → diff body → ReviewHintBar. Static, frame-driven.
//
// Selection cycles through DEMO_FILES_V4 every CYCLE frames after entryFrame +
// SELECT_START. Reviewed count rises in step. Used by both s5DiffPanel and
// (via keyboard-nav demo) s6FileNav.

import { interpolate, useCurrentFrame } from "remotion";
import { useColorsV4 } from "../colors-v4";
import { DEMO_FILES_V4 } from "../data";
import { tokenizeTs } from "../syntax";

const SELECT_START = 90;
const CYCLE = 160;
const ALL_COUNT = 12;
const WORKING_COUNT = 3;
const BRANCH_COUNT = 9;

interface ReviewTabV4Props {
	entryFrame: number;
	currentBranch: string;
	baseBranch: string;
}

export function ReviewTabV4({ entryFrame, currentBranch, baseBranch }: ReviewTabV4Props) {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - entryFrame;

	const tabsOp = interpolate(local, [0, 24], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const progressOp = interpolate(local, [18, 42], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const bodyOp = interpolate(local, [SELECT_START - 30, SELECT_START], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const selectedIndex = Math.max(
		0,
		Math.min(DEMO_FILES_V4.length - 1, Math.floor((local - SELECT_START) / CYCLE))
	);
	const selectedFile = DEMO_FILES_V4[selectedIndex] ?? DEMO_FILES_V4[0];
	if (!selectedFile) return null;

	// j key pulses on each cycle boundary
	const cyclePhase = ((local - SELECT_START) % CYCLE) / CYCLE;
	const jPulse =
		local > SELECT_START && cyclePhase < 0.1
			? interpolate(cyclePhase, [0, 0.1], [1, 0], { extrapolateRight: "clamp" })
			: 0;

	return (
		<div
			style={{
				flex: 1,
				background: c.bgBase,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			<FilterTabsRow opacity={tabsOp} />
			<ModeRow opacity={progressOp} splitMode="unified" />
			<FilePathStrip opacity={progressOp} path={selectedFile.path} />
			<div style={{ flex: 1, overflow: "hidden", opacity: bodyOp }}>
				<DiffBody file={selectedFile} currentBranch={currentBranch} baseBranch={baseBranch} />
			</div>
			<HintBar jPulse={jPulse} />
		</div>
	);
}

function FilterTabsRow({ opacity }: { opacity: number }) {
	const c = useColorsV4();
	const tabs = [
		{ key: "all", label: "All", count: ALL_COUNT, hint: "1" },
		{ key: "working", label: "Working", count: WORKING_COUNT, hint: "2" },
		{ key: "branch", label: "Branch", count: BRANCH_COUNT, hint: "3" },
	] as const;
	const activeKey = "branch";

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 4,
				borderBottom: `1px solid ${c.borderSubtle}`,
				padding: "4px 8px",
				opacity,
			}}
		>
			{tabs.map((t) => {
				const active = activeKey === t.key;
				return (
					<div
						key={t.key}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							padding: "3px 8px",
							borderRadius: 4,
							background: active ? c.bgElevated : "transparent",
							color: active ? c.text : c.textTertiary,
							fontSize: 11,
							fontWeight: active ? 500 : 400,
						}}
					>
						<span>{t.label}</span>
						<span style={{ color: c.textQuaternary, fontVariantNumeric: "tabular-nums" }}>
							{t.count}
						</span>
						<kbd
							style={{
								background: c.bgOverlay,
								color: c.textQuaternary,
								padding: "0 4px",
								fontSize: 9,
								borderRadius: 3,
							}}
						>
							{t.hint}
						</kbd>
					</div>
				);
			})}
		</div>
	);
}

function ModeRow({
	opacity,
	splitMode,
}: {
	opacity: number;
	splitMode: "split" | "unified";
}) {
	const c = useColorsV4();

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "flex-end",
				gap: 10,
				padding: "6px 12px",
				borderBottom: `1px solid ${c.borderSubtle}`,
				opacity,
			}}
		>
			<div
				style={{
					padding: "1px 8px",
					border: `1px solid ${c.borderSubtle}`,
					borderRadius: 4,
					fontSize: 10,
					color: c.textTertiary,
				}}
			>
				{splitMode === "split" ? "Split" : "Unified"}
			</div>
		</div>
	);
}

function FilePathStrip({ opacity, path }: { opacity: number; path: string }) {
	const c = useColorsV4();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				height: 22,
				padding: "0 12px",
				background: c.bgSurface,
				borderBottom: `1px solid ${c.borderSubtle}`,
				fontSize: 11,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				color: c.textQuaternary,
				opacity,
				overflow: "hidden",
				whiteSpace: "nowrap",
				textOverflow: "ellipsis",
			}}
		>
			{path}
		</div>
	);
}

function HintBar({ jPulse }: { jPulse: number }) {
	const c = useColorsV4();
	const hints = [
		{ keys: ["J"], label: "Next" },
		{ keys: ["K"], label: "Prev" },
		{ keys: ["E"], label: "Edit" },
		{ keys: ["V"], label: "Viewed" },
		{ keys: ["1", "2", "3"], label: "Filter" },
		{ keys: ["Esc"], label: "Close" },
	];
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 16,
				padding: "4px 12px",
				borderTop: `1px solid ${c.borderSubtle}`,
				background: c.bgSurface,
				fontSize: 10,
				color: c.textQuaternary,
			}}
		>
			{hints.map((h) => (
				<div key={h.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
					{h.keys.map((k) => {
						const isJ = k === "J";
						return (
							<kbd
								key={k}
								style={{
									background: isJ && jPulse > 0 ? c.accent : c.bgOverlay,
									color: isJ && jPulse > 0 ? "#fff" : c.textTertiary,
									padding: "1px 4px",
									fontSize: 9,
									borderRadius: 3,
									transition: "background 120ms",
								}}
							>
								{k}
							</kbd>
						);
					})}
					<span>{h.label}</span>
				</div>
			))}
		</div>
	);
}

// Renders the selected file's diff as a simple unified-diff style: context
// lines around hunks, deletions in red, additions in green.
function DiffBody({
	file,
	currentBranch,
	baseBranch,
}: {
	file: (typeof DEMO_FILES_V4)[number];
	currentBranch: string;
	baseBranch: string;
}) {
	const c = useColorsV4();
	const lines: { kind: "ctx" | "del" | "add" | "hunk"; text: string; n?: number }[] = [];

	for (const hunk of file.hunks) {
		lines.push({
			kind: "hunk",
			text: `@@ ${baseBranch}:${file.path}:${hunk.startLine} → ${currentBranch} @@`,
		});
		for (const line of hunk.deletions) {
			lines.push({ kind: "del", text: line });
		}
		for (const line of hunk.additions) {
			lines.push({ kind: "add", text: line });
		}
	}

	return (
		<div
			style={{
				height: "100%",
				overflow: "auto",
				padding: "8px 0",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				fontSize: 11,
				lineHeight: "18px",
			}}
		>
			{lines.map((l, i) => {
				const bg =
					l.kind === "add"
						? "rgba(105,219,124,0.10)"
						: l.kind === "del"
							? "rgba(255,107,107,0.10)"
							: "transparent";
				const prefixColor =
					l.kind === "add" ? c.success : l.kind === "del" ? "#ff8a8a" : c.textQuaternary;
				const prefix =
					l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "hunk" ? " " : " ";
				if (l.kind === "hunk") {
					return (
						<div
							key={`${l.kind}-${i}`}
							style={{ display: "flex", padding: "0 12px", whiteSpace: "pre" }}
						>
							<span style={{ width: 14, color: prefixColor, flexShrink: 0 }}>{prefix}</span>
							<span style={{ color: prefixColor, fontStyle: "italic" }}>{l.text}</span>
						</div>
					);
				}
				const tokens = tokenizeTs(l.text, c.textSecondary);
				return (
					<div
						key={`${l.kind}-${i}`}
						style={{ display: "flex", background: bg, padding: "0 12px", whiteSpace: "pre" }}
					>
						<span style={{ width: 14, color: prefixColor, flexShrink: 0 }}>{prefix}</span>
						<span>
							{tokens.map((t, ti) => (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: token stream
									key={ti}
									style={{ color: t.color, fontStyle: t.italic ? "italic" : "normal" }}
								>
									{t.text}
								</span>
							))}
						</span>
					</div>
				);
			})}
		</div>
	);
}
