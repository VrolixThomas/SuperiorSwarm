import { type ReactNode, useEffect, useRef } from "react";

interface SidePanelProps {
	mode: "threads" | "ask";
	openCount: number;
	onModeChange: (mode: "threads" | "ask") => void;
	onClose: () => void;
	children: ReactNode;
}

export function SidePanel({ mode, openCount, onModeChange, onClose, children }: SidePanelProps) {
	const panel = useRef<HTMLElement>(null);
	useEffect(() => {
		const previous = document.activeElement;
		panel.current?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, []);
	return (
		<aside
			ref={panel}
			tabIndex={-1}
			aria-label={mode === "ask" ? "Ask agent" : "Review threads"}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !event.defaultPrevented) {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}
			}}
			className="absolute inset-y-0 right-0 z-30 flex w-[400px] max-w-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] outline-none"
		>
			<div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
				<button
					type="button"
					aria-pressed={mode === "threads"}
					onClick={() => onModeChange("threads")}
					className={`rounded-md px-2 py-1 text-[13px] ${mode === "threads" ? "bg-[var(--bg-overlay)]" : "text-[var(--text-secondary)]"}`}
				>
					Threads · {openCount}
				</button>
				<button
					type="button"
					aria-pressed={mode === "ask"}
					onClick={() => onModeChange("ask")}
					className={`rounded-md px-2 py-1 text-[13px] ${mode === "ask" ? "bg-[var(--bg-overlay)]" : "text-[var(--text-secondary)]"}`}
				>
					Ask agent
				</button>
				<button
					type="button"
					aria-label="Close side panel"
					onClick={onClose}
					className="ml-auto rounded-md px-2 py-1 text-[14px] text-[var(--text-tertiary)]"
				>
					×
				</button>
			</div>
			{children}
		</aside>
	);
}
