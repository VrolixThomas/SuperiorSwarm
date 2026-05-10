import { useEffect, useState } from "react";
import type { AgentConfirmRequestPayload } from "../../shared/types";

export function ConfirmAgentActionModal() {
	const [req, setReq] = useState<AgentConfirmRequestPayload | null>(null);

	useEffect(() => {
		const off = window.electron.agentConfirm.onRequest((payload) => setReq(payload));
		return off;
	}, []);

	if (!req) return null;

	const reply = (allow: boolean) => {
		window.electron.agentConfirm.reply(req.id, allow);
		setReq(null);
	};

	const title = req.kind === "dispatch" ? "Allow agent dispatch?" : "Allow worktree removal?";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm">
			<div className="w-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 text-[var(--text)] shadow-[var(--shadow-md)]">
				<h2 className="text-[15px] font-semibold">{title}</h2>
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
						type="button"
						className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors duration-[120ms] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						onClick={() => reply(false)}
					>
						Deny
					</button>
					<button
						type="button"
						className="rounded-[var(--radius-sm)] bg-[var(--color-success)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors duration-[120ms] hover:opacity-90"
						onClick={() => reply(true)}
					>
						Allow
					</button>
				</div>
			</div>
		</div>
	);
}
