import { Fragment, useCallback, useRef } from "react";
import { useTerminalStore } from "../stores/terminal";

function Tab({
	tab,
	isActive,
	onSelect,
	onClose,
}: {
	tab: { id: string; title: string };
	isActive: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);

	const showClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "1";
	}, [isActive]);
	const hideClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "0";
	}, [isActive]);

	return (
		<div
			role="tab"
			tabIndex={0}
			aria-selected={isActive}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			onMouseEnter={showClose}
			onMouseLeave={hideClose}
			className={`group relative flex h-[36px] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-2 rounded-[7px] pl-4 pr-2 text-[13px] transition-all duration-[120ms] ${
				isActive
					? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_0.5px_0_rgba(255,255,255,0.04)]"
					: "bg-transparent text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-secondary)]"
			}`}
			style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
		>
			{isActive && (
				<span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />
			)}

			<span className="min-w-0 truncate">{tab.title}</span>

			<button
				type="button"
				ref={closeRef}
				aria-label="Close tab"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-none bg-transparent p-0 transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)] ${
					isActive
						? "text-[var(--text-tertiary)] opacity-100"
						: "text-[var(--text-quaternary)] opacity-0"
				}`}
			>
				<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
					<path
						d="M2 2l5 5M7 2l-5 5"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</div>
	);
}

export function TerminalTabs() {
	const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useTerminalStore();

	return (
		<div
			className="flex h-[52px] shrink-0 items-end border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			<div
				role="tablist"
				className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 pb-[7px]"
			>
				{tabs.map((tab, i) => {
					const isActive = tab.id === activeTabId;
					const prevIsActive = i > 0 && tabs[i - 1].id === activeTabId;

					return (
						<Fragment key={tab.id}>
							{i > 0 && !isActive && !prevIsActive && (
								<div className="mx-px h-[14px] w-px shrink-0 rounded-full bg-[var(--border)]" />
							)}
							{i > 0 && (isActive || prevIsActive) && <div className="w-1 shrink-0" />}

							<Tab
								tab={tab}
								isActive={isActive}
								onSelect={() => setActiveTab(tab.id)}
								onClose={() => removeTab(tab.id)}
							/>
						</Fragment>
					);
				})}
			</div>

			<div className="shrink-0 pb-[7px] pr-2">
				<button
					type="button"
					aria-label="New tab"
					onClick={addTab}
					className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] border-none bg-transparent text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
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
	);
}
