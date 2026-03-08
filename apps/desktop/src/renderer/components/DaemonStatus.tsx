import { useEffect, useState } from "react";

export function DaemonStatus() {
	const [connected, setConnected] = useState<boolean | null>(null);

	useEffect(() => {
		const api = window.electron;
		if (!api?.daemon) return;

		// Query initial status — don't assume connected
		api.daemon.getStatus().then(setConnected);

		// Subscribe to live updates
		return api.daemon.onStatus(setConnected);
	}, []);

	if (connected !== false) return null;

	return (
		<div
			style={{
				position: "fixed",
				bottom: 8,
				right: 8,
				padding: "4px 10px",
				borderRadius: 4,
				backgroundColor: "var(--bg-overlay)",
				color: "var(--text-tertiary)",
				fontSize: 11,
				fontFamily: "var(--font-mono, monospace)",
				border: "1px solid var(--border)",
				zIndex: 9999,
				opacity: 0.9,
			}}
		>
			Daemon disconnected — reconnecting...
		</div>
	);
}
