// Mirrors apps/desktop/.../DiffPanel.tsx PanelHeader + body:
// - Icon row: [Changes | Files | Comments | Fixes] (real PanelHeader)
// - SmartHeaderBar: repo/branch chip (MarketingImages → main)
// - Body switches by mode: "changes" (DraftCommitCard + BranchChanges +
//   CommittedStack) or "files" (mock RepoFileTree).

import type { ReactElement } from "react";
import { BranchChanges } from "../build-real/BranchChanges";
import { CommentsOverviewTab } from "../build-real/CommentsOverviewTab";
import { CommittedStack } from "../build-real/CommittedStack";
import { DraftCommitCard } from "../build-real/DraftCommitCard";
import { useColorsV4 } from "./colors-v4";

const RIGHT_PANEL_W = 420;

export type RightPanelModeV4 = "changes" | "files" | "comments" | "ai-fixes";

interface Props {
	mode: RightPanelModeV4;
}

export function RightPanelV4({ mode }: Props) {
	const c = useColorsV4();

	return (
		<div
			style={{
				width: RIGHT_PANEL_W,
				flexShrink: 0,
				overflow: "hidden",
				background: c.bgSurface,
				borderLeft: `1px solid ${c.borderSubtle}`,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<PanelHeaderV4 activeTab={mode} />
			{mode === "changes" && <BranchChipRow repo="feat/agent-stream" branch="main" />}
			<div style={{ flex: 1, overflowY: "auto" }}>
				{mode === "files" ? (
					<RepoFileTreeV4 />
				) : mode === "comments" ? (
					<CommentsOverviewTab />
				) : (
					<>
						<DraftCommitCard />
						<div style={{ marginTop: 12 }}>
							<BranchChanges />
						</div>
						<div style={{ marginTop: 4, marginBottom: 16 }}>
							<CommittedStack />
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function PanelHeaderV4({ activeTab }: { activeTab: RightPanelModeV4 }) {
	const c = useColorsV4();
	const tabs: { key: RightPanelModeV4; icon: ReactElement }[] = [
		{ key: "changes", icon: <ChangesIcon /> },
		{ key: "files", icon: <FilesIcon /> },
		{ key: "comments", icon: <CommentsIcon /> },
		{ key: "ai-fixes", icon: <FixesIcon /> },
	];

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "8px 12px",
				borderBottom: `1px solid ${c.borderSubtle}`,
			}}
		>
			<div
				style={{
					display: "flex",
					background: c.bgBase,
					padding: 2,
					borderRadius: 6,
				}}
			>
				{tabs.map((t) => {
					const active = activeTab === t.key;
					return (
						<div
							key={t.key}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 4,
								padding: "4px 8px",
								borderRadius: 4,
								background: active ? c.bgElevated : "transparent",
								color: active ? c.textSecondary : c.textQuaternary,
								transition: "all 120ms",
								boxShadow: active ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
							}}
						>
							{t.icon}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function BranchChipRow({ repo, branch }: { repo: string; branch: string }) {
	const c = useColorsV4();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 12px",
				borderBottom: `1px solid ${c.borderSubtle}`,
				fontSize: 11,
				color: c.textTertiary,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "3px 8px",
					background: c.bgOverlay,
					borderRadius: 4,
				}}
			>
				<BranchIcon />
				<span style={{ fontWeight: 500, color: c.text }}>{repo}</span>
				<ChevronDown />
			</div>
			<span style={{ color: c.textQuaternary }}>{"→"}</span>
			<span style={{ color: c.textSecondary }}>{branch}</span>
		</div>
	);
}

function RepoFileTreeV4() {
	const c = useColorsV4();
	const tree: { name: string; depth: number; kind: "dir" | "file"; open?: boolean }[] = [
		{ name: "apps", depth: 0, kind: "dir", open: true },
		{ name: "desktop", depth: 1, kind: "dir", open: true },
		{ name: "src", depth: 2, kind: "dir", open: true },
		{ name: "main", depth: 3, kind: "dir" },
		{ name: "renderer", depth: 3, kind: "dir", open: true },
		{ name: "components", depth: 4, kind: "dir", open: true },
		{ name: "TabBar.tsx", depth: 5, kind: "file" },
		{ name: "DiffPanel.tsx", depth: 5, kind: "file" },
		{ name: "review", depth: 5, kind: "dir", open: true },
		{ name: "ReviewTab.tsx", depth: 6, kind: "file" },
		{ name: "ReviewProgressBar.tsx", depth: 6, kind: "file" },
		{ name: "hooks", depth: 4, kind: "dir", open: true },
		{ name: "useAgentTerminalStream.ts", depth: 5, kind: "file" },
		{ name: "useRepoSubscription.ts", depth: 5, kind: "file" },
		{ name: "shared", depth: 3, kind: "dir" },
		{ name: "trailer", depth: 1, kind: "dir" },
		{ name: "packages", depth: 0, kind: "dir" },
		{ name: "README.md", depth: 0, kind: "file" },
		{ name: "package.json", depth: 0, kind: "file" },
		{ name: "biome.json", depth: 0, kind: "file" },
	];

	return (
		<div style={{ display: "flex", flexDirection: "column" }}>
			<TreeSearchBar />
			<TreeToolbar />
			<div style={{ padding: "4px 0" }}>
				{tree.map((n, i) => (
					<div
						key={`${n.name}-${i}`}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							paddingLeft: 6 + n.depth * 16,
							paddingRight: 8,
							paddingTop: 2,
							paddingBottom: 2,
							color: c.textSecondary,
							fontSize: 12,
						}}
					>
						{n.kind === "dir" ? (
							<>
								<TreeChevron open={!!n.open} />
								<TreeFolderIcon open={!!n.open} />
							</>
						) : (
							<>
								<span style={{ width: 10, display: "inline-block", flexShrink: 0 }} />
								<TreeFileIcon color={fileColor(n.name)} />
							</>
						)}
						<span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
							{n.name}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function fileColor(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "tsx" || ext === "ts") return "#60a5fa";
	if (ext === "json") return "#facc15";
	if (ext === "md") return "#94a3b8";
	return "var(--text-quaternary)";
}

function TreeSearchBar() {
	const c = useColorsV4();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 8px",
				borderBottom: `1px solid ${c.borderSubtle}`,
				color: c.textQuaternary,
				fontSize: 12,
			}}
		>
			<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
				<path d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z" />
			</svg>
			<span style={{ color: c.textQuaternary }}>Search files…</span>
		</div>
	);
}

function TreeToolbar() {
	const c = useColorsV4();
	const icons = [
		// compact toggle
		<svg key="compact" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<rect x="2" y="3" width="12" height="2" rx="1" />
			<rect x="2" y="7" width="12" height="2" rx="1" />
			<rect x="2" y="11" width="12" height="2" rx="1" />
		</svg>,
		// hidden toggle
		<svg key="hidden" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3" />
			<circle cx="8" cy="8" r="1.8" fill="currentColor" />
		</svg>,
		// expand all
		<svg key="expand" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M5 6l3 3 3-3" />
		</svg>,
		// collapse all
		<svg key="collapse" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M5 9l3-3 3 3" />
		</svg>,
		// refresh
		<svg key="refresh" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M3 8a5 5 0 018.5-3.5L13 6V3M13 8a5 5 0 01-8.5 3.5L3 10v3"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
			/>
		</svg>,
	];
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 2,
				padding: "4px 8px",
				borderBottom: `1px solid ${c.borderSubtle}`,
				color: c.textQuaternary,
			}}
		>
			{icons.map((icon, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: static icon list
					key={i}
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: 22,
						height: 20,
						borderRadius: 4,
					}}
				>
					{icon}
				</div>
			))}
		</div>
	);
}

function TreeChevron({ open }: { open: boolean }) {
	const c = useColorsV4();
	return (
		<svg
			width="10"
			height="10"
			viewBox="0 0 16 16"
			fill={c.textQuaternary}
			aria-hidden="true"
			style={{
				transform: open ? "rotate(90deg)" : "rotate(0deg)",
				transition: "transform 120ms",
				flexShrink: 0,
			}}
		>
			<path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
		</svg>
	);
}

function TreeFolderIcon({ open }: { open: boolean }) {
	const c = useColorsV4();
	if (open) {
		return (
			<svg
				width="13"
				height="13"
				viewBox="0 0 16 16"
				fill={c.textTertiary}
				aria-hidden="true"
				style={{ flexShrink: 0 }}
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
			width="13"
			height="13"
			viewBox="0 0 16 16"
			fill={c.textTertiary}
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<path d="M2.5 1.75A.75.75 0 013.25 1h4.035a.75.75 0 01.573.268l1.2 1.427a.25.25 0 00.191.089h4.001a.75.75 0 01.75.75v9.716a.75.75 0 01-.75.75H3.25a.75.75 0 01-.75-.75V1.75z" />
		</svg>
	);
}

function TreeFileIcon({ color }: { color: string }) {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 16 16"
			aria-hidden="true"
			style={{ color, flexShrink: 0 }}
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

function ChangesIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path d="M3 4h10M3 8h7M3 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	);
}

function FilesIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M2.5 4.5C2.5 3.95 2.95 3.5 3.5 3.5h3l1.5 1.5h4.5c.55 0 1 .45 1 1V12c0 .55-.45 1-1 1h-9c-.55 0-1-.45-1-1V4.5z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function CommentsIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M3 4.5c0-.55.45-1 1-1h8c.55 0 1 .45 1 1V10c0 .55-.45 1-1 1H7l-2.5 2.2V11H4c-.55 0-1-.45-1-1V4.5z"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function FixesIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M8 1.5l1.6 4.3L14 7l-3.5 2.5L11.5 14 8 11.6 4.5 14l1-4.5L2 7l4.4-1.2L8 1.5z"
				stroke="currentColor"
				strokeWidth="1.1"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function BranchIcon() {
	const c = useColorsV4();
	return (
		<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="M4 3v10M4 6c0 2 4 1 4 4v3M12 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4 4.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4 14.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
				stroke={c.textTertiary}
				strokeWidth="1.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ChevronDown() {
	const c = useColorsV4();
	return (
		<svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<path
				d="M3 4.5l3 3 3-3"
				stroke={c.textQuaternary}
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

