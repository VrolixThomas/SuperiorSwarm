import { DIFF_LINES } from "./mock-data";

export function DiffView() {
	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* File tab bar — matches real app PaneTabBar */}
			<div className="flex h-[36px] shrink-0 items-center border-b border-border bg-bg-elevated">
				{/* Pane index */}
				<div className="flex h-full w-[28px] shrink-0 items-center justify-center text-[11px] font-medium text-text-faint">
					1
				</div>

				{/* Active tab pill */}
				<div className="relative flex h-[28px] max-w-[200px] shrink-0 items-center gap-1.5 rounded-[6px] bg-bg-overlay pl-2.5 pr-1.5 text-[12px] text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_0.5px_0_rgba(255,255,255,0.04)]">
					<span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />
					<span className="min-w-0 truncate">chat-service.ts (fix)</span>
					<span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] text-text-muted">
						<svg aria-hidden="true" width="8" height="8" viewBox="0 0 9 9" fill="none">
							<path
								d="M2 2l5 5M7 2l-5 5"
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
							/>
						</svg>
					</span>
				</div>

				{/* Spacer + new tab button */}
				<div className="flex-1" />
				<div className="shrink-0 pr-1">
					<div className="flex h-[24px] w-[24px] items-center justify-center rounded text-text-faint hover:bg-bg-overlay hover:text-text-muted">
						<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
							<path
								d="M8 3v10M3 8h10"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</div>
				</div>
			</div>

			{/* File path bar — file path, commit hash, inline toggle */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-bg-surface px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-text-faint">
					src/main/chat/chat-service.ts
				</span>
				<span className="font-mono text-[10px] text-text-faint">a7f3c21</span>
				<span className="rounded px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-secondary">
					Inline
				</span>
			</div>

			{/* Two-column diff */}
			<div className="flex-1 overflow-auto bg-bg-base">
				<table className="w-full border-collapse font-mono text-[11px] leading-[1.7]">
					<tbody>
						{DIFF_LINES.map((line, i) => {
							const isRemove = line.type === "remove";
							const isAdd = line.type === "add";

							const rowBg = isRemove ? "bg-red/[0.06]" : isAdd ? "bg-green/[0.06]" : "";

							const prefix = isRemove ? "-" : isAdd ? "+" : " ";

							const textColor = isRemove
								? "text-red/80"
								: isAdd
									? "text-green/80"
									: "text-text-muted";

							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: static mock data
								<tr key={i} className={rowBg}>
									{/* Left line number */}
									<td className="w-[42px] select-none border-r border-border px-2 text-right text-[10px] text-text-faint/50">
										{line.left || ""}
									</td>
									{/* Right line number */}
									<td className="w-[42px] select-none border-r border-border px-2 text-right text-[10px] text-text-faint/50">
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
