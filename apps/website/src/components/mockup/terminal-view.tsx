import { useState } from "react";
import { FileIcon } from "./icons";

type CenterTab = "terminal" | "OrchestratorRow.tsx" | "OrchestratorGroup.tsx";

export function TerminalView() {
	const [activeTab, setActiveTab] = useState<CenterTab>("terminal");

	return (
		<div className="flex flex-1 flex-col">
			{/* Pane tab bar — matches real TabBar.tsx (52px, 36px pills, 2px accent underline) */}
			<div className="flex h-[52px] shrink-0 items-end border-b border-app-border bg-app-bg-tab-bar">
				<div className="flex h-full w-full items-end gap-[2px] pb-[7px] pl-2 pr-1">
					<TabPill
						active={activeTab === "terminal"}
						onClick={() => setActiveTab("terminal")}
						icon={
							<span className="shrink-0 font-mono text-[11px] text-app-text-quaternary">&gt;_</span>
						}
						label="Claude Code"
					/>
					<TabPill
						active={activeTab === "OrchestratorRow.tsx"}
						onClick={() => setActiveTab("OrchestratorRow.tsx")}
						icon={<FileIcon color="#3178c6" />}
						label="OrchestratorRow.tsx"
					/>
					<TabPill
						active={activeTab === "OrchestratorGroup.tsx"}
						onClick={() => setActiveTab("OrchestratorGroup.tsx")}
						icon={<FileIcon color="#3178c6" />}
						label="OrchestratorGroup.tsx"
					/>

					<div className="flex-1" />

					<button
						type="button"
						title="New terminal"
						className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-app-text-quaternary transition-colors hover:bg-app-bg-elevated hover:text-app-text-secondary"
					>
						<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none">
							<path
								d="M8 3v10M3 8h10"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>
			</div>

			{/* Tab content */}
			{activeTab === "terminal" && <TerminalContent />}
			{activeTab === "OrchestratorRow.tsx" && <CodeEditorContent file="OrchestratorRow.tsx" />}
			{activeTab === "OrchestratorGroup.tsx" && <CodeEditorContent file="OrchestratorGroup.tsx" />}
		</div>
	);
}

function TabPill({
	active,
	onClick,
	icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={[
				"group relative flex h-[36px] max-w-[220px] shrink-0 items-center gap-2 rounded-[7px] pl-3 pr-2 text-[13px] transition-colors",
				active
					? "bg-app-tab-active text-app-text shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
					: "text-app-text-quaternary hover:text-app-text-tertiary",
			].join(" ")}
		>
			{active && (
				<span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-app-accent" />
			)}
			{icon}
			<span className="min-w-0 truncate">{label}</span>
			<span
				className={[
					"flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] transition-opacity",
					active
						? "text-app-text-tertiary"
						: "text-app-text-quaternary opacity-0 group-hover:opacity-100",
				].join(" ")}
			>
				<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
					<path
						d="M2 2l5 5M7 2l-5 5"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</span>
		</button>
	);
}

function TerminalContent() {
	return (
		<div className="flex-1 overflow-hidden p-3">
			<pre className="font-mono text-[11px] leading-[1.7] text-app-text">
				{/* Shell prompt */}
				<span className="text-app-accent">~/SuperiorSwarm</span>
				<span className="text-app-text-tertiary"> on </span>
				<span className="text-app-purple">orchestrator-ordering</span>
				{"\n"}
				<span className="text-app-success">❯ </span>
				<span className="text-app-text">claude</span>
				{"\n"}
				{/* Minimal Claude Code header — matches the real ── line style */}
				<span className="text-app-accent">{"── "}</span>
				<span className="text-app-accent">Claude Code</span>
				<span className="text-app-text-quaternary"> v2.1.87</span>
				<span className="text-app-accent">{" ──────────────────────────────────────────"}</span>
				{"\n\n"}
				{/* User prompt */}
				<span className="text-app-text">
					{">"} let me reorder orchestrator groups with drag-and-drop
				</span>
				{"\n\n"}
				{/* Agent reading files */}
				<span className="text-app-text-quaternary">{"  ⠸ "}</span>
				<span className="text-app-text-tertiary">Analyzing codebase...</span>
				{"\n"}
				<span className="text-app-text-quaternary">{"  ⠸ "}</span>
				<span className="text-app-text-tertiary">
					Reading ProjectItem.tsx, OrchestratorRow.tsx, OrchestratorGroup.tsx
				</span>
				{"\n\n"}
				{/* File operations */}
				<span className="text-app-success">{"  ✓ "}</span>
				<span className="text-app-text-secondary">Modified </span>
				<span className="text-app-text">src/renderer/components/ProjectItem.tsx</span>
				<span className="text-app-success"> +52</span>
				<span className="text-app-danger"> -6</span>
				{"\n"}
				<span className="text-app-success">{"  ✓ "}</span>
				<span className="text-app-text-secondary">Modified </span>
				<span className="text-app-text">src/renderer/components/OrchestratorRow.tsx</span>
				<span className="text-app-success"> +14</span>
				<span className="text-app-danger"> -2</span>
				{"\n"}
				<span className="text-app-success">{"  ✓ "}</span>
				<span className="text-app-text-secondary">Modified </span>
				<span className="text-app-text">src/main/trpc/routers/workspaces.ts</span>
				<span className="text-app-success"> +28</span>
				<span className="text-app-danger"> -0</span>
				{"\n\n"}
				{/* Test results */}
				<span className="text-app-text-secondary">{"  "}Running tests...</span>
				{"\n"}
				<span className="text-app-success">{"  ✓ "}</span>
				<span className="text-app-text-secondary">
					workspaces.reorderTopLevel.test.ts (5 tests)
				</span>
				{"\n"}
				<span className="text-app-success">{"  ✓ "}</span>
				<span className="text-app-text-secondary">
					workspaces.reorderChildren.test.ts (4 tests)
				</span>
				{"\n"}
				<span className="text-app-success">{"  ✓ "}</span>
				<span className="text-app-success">9 tests passed</span>
				{"\n\n"}
				{/* Cursor */}
				<span className="text-app-text">{">"} </span>
				<span className="animate-pulse text-app-text">█</span>
			</pre>
		</div>
	);
}

// Real excerpts from apps/desktop/src/renderer/components/
const ORCH_ROW_CODE = `import { useState } from "react";
import { useTabStore } from "../stores/tab-store";

interface OrchestratorRowProps {
  workspace: { id: string; name: string };
  colorIndex: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  childCount: number;
  expanded: boolean;
  onToggle: () => void;
  onActivate: () => void;
}

export function OrchestratorRow({
  workspace,
  colorIndex,
  childCount,
  expanded,
  onToggle,
  onActivate,
}: OrchestratorRowProps) {
  const isActive = useTabStore((s) => s.activeWorkspaceId === workspace.id);
  const swatchVar = \`var(--orch-\${colorIndex})\`;
  const pillBg = \`var(--orch-\${colorIndex}-bg)\`;

  return (
    <div
      className={[
        "group relative flex items-center w-full rounded-[6px]",
        isActive
          ? "bg-[var(--accent-subtle)]"
          : "hover:bg-[var(--bg-elevated)]",
      ].join(" ")}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-[var(--accent)]"
        />
      )}

      <button
        type="button"
        onClick={onActivate}
        className="flex min-w-0 flex-1 items-center gap-2 pl-[22px] pr-2 py-[7px]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="2.5" r="1.4" stroke={swatchVar} />
          <circle cx="2.5" cy="9.5" r="1.4" stroke={swatchVar} />
          <circle cx="9.5" cy="9.5" r="1.4" stroke={swatchVar} />
          <path d="M6 4 L3 8 M6 4 L9 8" stroke={swatchVar} />
        </svg>
        <span className="flex-1 truncate text-[13px] font-medium">
          {workspace.name}
        </span>
        <span
          className="px-[7px] py-px rounded-[9px] text-[10px]"
          style={{ background: pillBg, color: swatchVar }}
        >
          {childCount}
        </span>
      </button>
    </div>
  );
}`;

const ORCH_GROUP_CODE = `import { Children } from "react";
import type { ReactNode } from "react";

interface OrchestratorGroupProps {
  colorIndex: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  hasActiveChild: boolean;
  children: ReactNode;
}

export function OrchestratorGroup({
  colorIndex,
  hasActiveChild,
  children,
}: OrchestratorGroupProps) {
  const railColor = \`var(--orch-\${colorIndex})\`;
  return (
    <div className="relative pl-[14px]">
      <span
        aria-hidden="true"
        className="absolute top-[2px] bottom-[4px] w-[2px] rounded-[2px]"
        style={{
          left: "26px",
          background: railColor,
          opacity: hasActiveChild ? 1 : 0.55,
        }}
      />
      {children}
      {Children.count(children) === 0 && (
        <div className="pl-[36px] py-2">
          <div className="text-[11px] text-[var(--text-tertiary)]">
            No worktrees attached.
          </div>
          <div className="text-[11px] text-[var(--text-quaternary)]">
            Drag a worktree here to attach.
          </div>
        </div>
      )}
    </div>
  );
}`;

const ORCH_ROW_LINES = ORCH_ROW_CODE.split("\n");
const ORCH_GROUP_LINES = ORCH_GROUP_CODE.split("\n");

function CodeEditorContent({ file }: { file: "OrchestratorRow.tsx" | "OrchestratorGroup.tsx" }) {
	const lines = file === "OrchestratorRow.tsx" ? ORCH_ROW_LINES : ORCH_GROUP_LINES;
	const filePath =
		file === "OrchestratorRow.tsx"
			? "src/renderer/components/OrchestratorRow.tsx"
			: "src/renderer/components/OrchestratorGroup.tsx";

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* File path bar */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-app-border-subtle bg-app-bg-surface px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-app-text-quaternary">
					{filePath}
				</span>
				<span className="font-mono text-[10px] text-app-text-quaternary">
					orchestrator-ordering
				</span>
			</div>

			{/* Code content */}
			<div className="flex-1 overflow-auto bg-app-bg-base">
				<table className="w-full border-collapse font-mono text-[11px] leading-[1.7]">
					<tbody>
						{lines.map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static mock data, never reorders
							<tr key={i} className="hover:bg-app-bg-elevated/40">
								<td className="w-[42px] select-none border-r border-app-border-subtle px-2 text-right text-[10px] text-app-text-quaternary/50">
									{i + 1}
								</td>
								<td className="whitespace-pre pl-3 pr-4 text-app-text-tertiary">
									<CodeLine content={line} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function CodeLine({ content }: { content: string }) {
	// Simple keyword-based highlighting for visual effect
	const highlighted = highlightSyntax(content);
	return <>{highlighted}</>;
}

function highlightSyntax(line: string): React.ReactNode[] {
	const result: React.ReactNode[] = [];
	let remaining = line;
	let keyIdx = 0;

	// Match patterns in order of priority — muted palette so keywords don't shout
	const patterns: [RegExp, string][] = [
		[/^(\/\/.*)/, "text-app-text-quaternary"], // single-line comments
		[
			/^(import|export|from|return|const|let|new|type|interface|class|function|if|else|async|await|typeof|private|this|void)\b/,
			"text-[#7fa3c7]", // desaturated slate-blue, lower-contrast than accent
		],
		[/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/, "text-[#a8c8a0]"], // muted green
		[/^(true|false|null|undefined|Date)\b/, "text-[#c8a87a]"], // muted amber
		[/^(\d+(?:_\d+)*)/, "text-[#c8a87a]"],
		[/^(=>|\.\.\.|\?\.)/, "text-app-text-tertiary"],
	];

	while (remaining.length > 0) {
		let matched = false;

		// Skip leading whitespace
		const wsMatch = remaining.match(/^(\s+)/);
		if (wsMatch?.[1]) {
			result.push(wsMatch[1]);
			remaining = remaining.slice(wsMatch[1].length);
			if (remaining.length === 0) break;
		}

		for (const [pattern, className] of patterns) {
			const m = remaining.match(pattern);
			if (m?.[1]) {
				result.push(
					<span key={keyIdx++} className={className}>
						{m[1]}
					</span>
				);
				remaining = remaining.slice(m[1].length);
				matched = true;
				break;
			}
		}

		if (!matched) {
			// Take one character or a word
			const wordMatch = remaining.match(/^([^\s"'`]+)/);
			if (wordMatch?.[1]) {
				result.push(wordMatch[1]);
				remaining = remaining.slice(wordMatch[1].length);
			} else {
				result.push(remaining[0] ?? "");
				remaining = remaining.slice(1);
			}
		}
	}

	return result;
}
