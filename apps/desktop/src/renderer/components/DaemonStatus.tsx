import { useEffect, useState } from "react";

export function DaemonStatus() {
	const [connected, setConnected] = useState(true);

	useEffect(() => {
		const api = window.electron;
		if (!api?.daemon) return;
		return api.daemon.onStatus(setConnected);
	}, []);

	if (connected) return null;

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
