import { useRef, useState } from "react";
import type {
	QueuePermissionAction,
	QueuePermissionDecisionProps,
} from "../../../shared/queue-permissions";

/** Only explicit button actions respond. A lost IPC result never makes the same request retryable. */
export function QueuePermissionDecision({
	item,
	capability,
	onDecide,
	onOpen,
	onChanged,
}: QueuePermissionDecisionProps) {
	const attempted = useRef(new Set<string>());
	const [message, setMessage] = useState<{ id: string; text: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const requestId = capability.requestId;
	const available =
		capability.capability === "hook-response" &&
		capability.state === "waiting" &&
		!!requestId &&
		!item.stale &&
		!attempted.current.has(requestId);
	const act = async (action: QueuePermissionAction) => {
		if (
			!available ||
			!requestId ||
			busy ||
			attempted.current.has(requestId) ||
			(action === "allow-once" && !capability.allowOnce)
		)
			return;
		attempted.current.add(requestId);
		setBusy(true);
		try {
			const result = await onDecide({
				id: item.id,
				revision: item.revision,
				members: item.members,
				requestId,
				action,
			});
			setMessage({ id: requestId, text: result.detail });
			if (action === "open" && result.status === "opened") onOpen();
			try {
				onChanged?.();
			} catch {
				/* A refresh failure never retries a decision. */
			}
		} catch {
			setMessage({
				id: requestId,
				text: "Delivery could not be confirmed. Do not retry this request; open the conversation to check its native prompt.",
			});
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			aria-label="Permission decision"
			className="my-4 space-y-3 border-y border-[var(--border-subtle)] py-4 text-[12px]"
		>
			<h3 className="font-medium">Permission request</h3>
			{capability.summary && (
				<pre className="whitespace-pre-wrap break-words font-mono">{capability.summary}</pre>
			)}
			<p>{capability.detail}</p>
			{available && (
				<div className="flex gap-2">
					<button
						type="button"
						disabled={busy || !capability.allowOnce}
						onClick={() => void act("allow-once")}
						className="rounded border border-[var(--border)] px-3 py-2"
					>
						Allow once
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void act("deny")}
						className="rounded border border-[var(--border)] px-3 py-2"
					>
						Deny
					</button>
				</div>
			)}
			<button
				type="button"
				disabled={busy}
				onClick={() => (available ? void act("open") : onOpen())}
				className="underline"
			>
				Open conversation
			</button>
			{message &&
				message.id === requestId &&
				message.text !== capability.detail &&
				capability.state !== "delivered-to-hook" && (
					<output className="block">{message.text}</output>
				)}
		</section>
	);
}
