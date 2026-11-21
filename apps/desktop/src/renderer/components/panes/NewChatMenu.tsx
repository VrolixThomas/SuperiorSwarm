import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OwnedChatProvider } from "../../../shared/owned-chat";
import { Popover } from "../ui/Popover";

export function NewChatMenu({
	startChat,
}: { startChat: (provider: OwnedChatProvider) => Promise<void> }) {
	const trigger = useRef<HTMLButtonElement>(null);
	const firstItem = useRef<HTMLButtonElement>(null);
	const running = useRef(false);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (position) firstItem.current?.focus();
	}, [position]);
	const close = () => {
		if (running.current) return;
		setPosition(null);
		trigger.current?.focus();
	};
	const start = async (provider: OwnedChatProvider) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setError(null);
		try {
			await startChat(provider);
			setPosition(null); // The new terminal owns focus after a successful launch.
		} catch {
			setError(
				"The chat could not start. Check the new terminal and this workspace before trying again."
			);
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	return (
		<>
			<button
				ref={trigger}
				type="button"
				aria-label="New agent chat"
				title="New agent chat"
				aria-haspopup="menu"
				aria-expanded={!!position}
				disabled={busy}
				onMouseDown={(event) => event.stopPropagation()}
				onClick={() => {
					if (position) {
						close();
						return;
					}
					const box = trigger.current?.getBoundingClientRect();
					if (box) {
						setError(null);
						setPosition({ x: Math.max(8, box.right - 230), y: box.bottom + 4 });
					}
				}}
				className="flex h-6 w-5 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
			>
				<svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none">
					<path
						d="m4 6 4 4 4-4"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
			{position &&
				createPortal(
					<Popover
						position={position}
						onClose={close}
						role="menu"
						aria-label="Start an agent chat"
						className="app-no-drag w-[230px] max-w-[calc(100vw-16px)] p-1 text-[12px]"
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								close();
								return;
							}
							if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
							const items = Array.from(
								event.currentTarget.querySelectorAll<HTMLButtonElement>(
									'[role="menuitem"]:not(:disabled)'
								)
							);
							if (!items.length) return;
							const current = items.indexOf(document.activeElement as HTMLButtonElement);
							const next =
								event.key === "Home"
									? 0
									: event.key === "End"
										? items.length - 1
										: (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
											items.length;
							event.preventDefault();
							items[next]?.focus();
						}}
					>
						{(["claude", "codex"] as const).map((provider, index) => (
							<button
								key={provider}
								ref={index === 0 ? firstItem : undefined}
								type="button"
								role="menuitem"
								disabled={busy}
								onClick={() => void start(provider)}
								className="block w-full rounded px-3 py-2 text-left text-[var(--text)] hover:bg-[var(--bg-elevated)] focus:bg-[var(--bg-elevated)] focus:outline-none disabled:opacity-50"
							>
								New {provider === "claude" ? "Claude" : "Codex"} chat
							</button>
						))}
						{busy && (
							<output className="block px-3 py-2 text-[var(--text-tertiary)]">
								Starting chat…
							</output>
						)}
						{error && (
							<p role="alert" className="px-3 py-2 text-[var(--text-secondary)]">
								{error}
							</p>
						)}
					</Popover>,
					document.body
				)}
		</>
	);
}
