import { DIFF_LINES } from "./mock-data";

export function DiffView() {
	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* File tab bar — diff tabs use yellow accent (TabBar.tsx:72) */}
			<div className="flex h-[52px] shrink-0 items-end border-b border-app-border bg-app-bg-tab-bar">
				<div className="flex h-full w-full items-end gap-[2px] pb-[7px] pl-2 pr-1">
					<div className="relative flex h-[36px] max-w-[220px] shrink-0 items-center gap-2 rounded-[7px] bg-app-tab-active pl-3 pr-2 text-[13px] text-app-text shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
						<span
							className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full"
							style={{ background: "var(--color-app-term-yellow)" }}
						/>
						<span
							className="size-1.5 shrink-0 rounded-full"
							style={{ background: "var(--color-app-term-yellow)" }}
						/>
						<span className="min-w-0 truncate">OrchestratorGroup.tsx (fix)</span>
						<span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-app-text-tertiary">
							<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
								<path
									d="M2 2l5 5M7 2l-5 5"
									stroke="currentColor"
									strokeWidth="1.4"
									strokeLinecap="round"
								/>
							</svg>
						</span>
					</div>

					<div className="flex-1" />

					<button
						type="button"
						title="New tab"
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

			{/* File path bar — file path, commit hash, inline toggle */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-app-border-subtle bg-app-bg-surface px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-app-text-quaternary">
					src/renderer/components/OrchestratorGroup.tsx
				</span>
				<span className="font-mono text-[10px] text-app-text-quaternary">a7f3c21</span>
				<span className="rounded px-2 py-0.5 text-[11px] text-app-text-tertiary transition-colors hover:bg-app-bg-elevated hover:text-app-text-secondary">
					Inline
				</span>
			</div>

			{/* Two-column diff */}
			<div className="flex-1 overflow-auto bg-app-bg-base">
				<table className="w-full border-collapse font-mono text-[11px] leading-[1.7]">
					<tbody>
						{DIFF_LINES.map((line, i) => {
							const isRemove = line.type === "remove";
							const isAdd = line.type === "add";

							const rowBg = isRemove
								? "bg-app-danger/[0.06]"
								: isAdd
									? "bg-app-success/[0.06]"
									: "";

							const prefix = isRemove ? "-" : isAdd ? "+" : " ";

							const textColor = isRemove
								? "text-app-danger/80"
								: isAdd
									? "text-app-success/80"
									: "text-app-text-tertiary";

							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: static mock data
								<tr key={i} className={rowBg}>
									{/* Left line number */}
									<td className="w-[42px] select-none border-r border-app-border-subtle px-2 text-right text-[10px] text-app-text-quaternary/50">
										{line.left || ""}
									</td>
									{/* Right line number */}
									<td className="w-[42px] select-none border-r border-app-border-subtle px-2 text-right text-[10px] text-app-text-quaternary/50">
										{line.right || ""}
									</td>
									{/* Prefix gutter */}
									<td className={`w-[20px] select-none pl-2 ${textColor}`}>{prefix}</td>
									{/* Code content */}
									<td className={`whitespace-pre pr-4 ${textColor}`}>{line.content}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
