import { useEffect, useRef, useState } from "react";
import type { AgentConfirmRequestPayload } from "../../shared/types";

export function ConfirmAgentActionModal() {
	const [req, setReq] = useState<AgentConfirmRequestPayload | null>(null);
	const denyButtonRef = useRef<HTMLButtonElement>(null);
	const allowButtonRef = useRef<HTMLButtonElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const off = window.electron.agentConfirm.onRequest((payload) => setReq(payload));
		return off;
	}, []);

	useEffect(() => {
		if (!req) return;

		const activeElement = document.activeElement;
		previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
		const focusFrame = requestAnimationFrame(() => denyButtonRef.current?.focus());

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				window.electron.agentConfirm.reply(req.id, false);
				setReq(null);
				return;
			}
			if (e.key !== "Tab") return;

			const buttons = [denyButtonRef.current, allowButtonRef.current].filter(
				(button): button is HTMLButtonElement => button !== null
			);
			const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
			if (currentIndex === -1) {
				e.preventDefault();
				(e.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
			} else if (e.shiftKey && currentIndex === 0) {
				e.preventDefault();
				buttons.at(-1)?.focus();
			} else if (!e.shiftKey && currentIndex === buttons.length - 1) {
				e.preventDefault();
				buttons[0]?.focus();
			}
		};

		document.addEventListener("keydown", handleKeyDown, true);
		return () => {
			cancelAnimationFrame(focusFrame);
			document.removeEventListener("keydown", handleKeyDown, true);
			const previousFocus = previousFocusRef.current;
			previousFocusRef.current = null;
			if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus());
		};
	}, [req]);

	if (!req) return null;

	const reply = (allow: boolean) => {
		window.electron.agentConfirm.reply(req.id, allow);
		setReq(null);
	};

	const title = req.kind === "dispatch" ? "Allow agent dispatch?" : "Allow worktree removal?";

	return (
		<div
			data-app-modal-root=""
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm"
		>
			<dialog
				open
				aria-modal="true"
				aria-labelledby="agent-confirm-title"
				className="relative m-0 w-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 text-[var(--text)] shadow-[var(--shadow-md)]"
			>
				<h2 id="agent-confirm-title" className="text-[15px] font-semibold">
					{title}
				</h2>
				<p className="mt-2 text-[13px] text-[var(--text-tertiary)]">
					Workspace: <span className="text-[var(--text)]">{req.workspaceName}</span>
					{req.branch ? (
						<>
							{" • "}
							<span className="text-[var(--text)]">{req.branch}</span>
						</>
					) : null}
				</p>
				<p className="mt-3 break-words text-[13px] text-[var(--text-secondary)]">{req.summary}</p>
				<div className="mt-5 flex justify-end gap-2">
					<button
						ref={denyButtonRef}
						type="button"
						className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors duration-[120ms] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
						onClick={() => reply(false)}
					>
						Deny
					</button>
					<button
						ref={allowButtonRef}
						type="button"
						className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent-foreground)] transition-colors duration-[120ms] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-hover)]"
						onClick={() => reply(true)}
					>
						Allow
					</button>
				</div>
			</dialog>
		</div>
	);
}
