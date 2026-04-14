import { trpc } from "@/trpc/client";

const PRIVACY_URL = "https://github.com/VrolixThomas/SuperiorSwarm/blob/main/PRIVACY.md";

export function ConsentScreen({ onDone }: { onDone: () => void }) {
	const utils = trpc.useUtils();
	const setConsent = trpc.telemetry.setConsent.useMutation({
		onSuccess: async () => {
			await utils.telemetry.getState.invalidate();
			onDone();
		},
	});

	const handleChoice = (optOut: boolean) => {
		setConsent.mutate({ optOut });
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				height: "100vh",
				background: "var(--bg-base)",
				gap: "16px",
				padding: "24px",
			}}
		>
			<div
				style={{
					maxWidth: "520px",
					display: "flex",
					flexDirection: "column",
					gap: "16px",
				}}
			>
				<h1
					style={{
						fontSize: "24px",
						fontWeight: 600,
						color: "var(--text)",
						margin: 0,
					}}
				>
					Help us improve SuperiorSwarm
				</h1>
				<p
					style={{
						fontSize: "14px",
						color: "var(--text-tertiary)",
						lineHeight: 1.5,
						margin: 0,
					}}
				>
					We'd like to send a small daily snapshot of your usage so we can see which versions are in
					use and which features matter. No repo contents, file paths, branch names, prompts, or
					personal info are collected — only counts and version strings.
				</p>
				<p style={{ fontSize: "13px", margin: 0 }}>
					<a
						href={PRIVACY_URL}
						target="_blank"
						rel="noreferrer"
						style={{ color: "var(--text-tertiary)" }}
					>
						Read the full privacy notice
					</a>
				</p>
				<div
					style={{
						display: "flex",
						gap: "10px",
						marginTop: "8px",
					}}
				>
					<button
						type="button"
						disabled={setConsent.isPending}
						onClick={() => handleChoice(true)}
						style={{
							padding: "10px 24px",
							minWidth: "140px",
							background: "var(--bg-elevated)",
							border: "1px solid var(--border-active)",
							borderRadius: "var(--radius-md)",
							color: "var(--text)",
							fontSize: "14px",
							fontWeight: 500,
							cursor: setConsent.isPending ? "not-allowed" : "pointer",
							opacity: setConsent.isPending ? 0.6 : 1,
							transition: "background var(--transition-fast)",
						}}
					>
						No thanks
					</button>
					<button
						type="button"
						disabled={setConsent.isPending}
						onClick={() => handleChoice(false)}
						style={{
							padding: "10px 24px",
							minWidth: "140px",
							background: "var(--bg-elevated)",
							border: "1px solid var(--border-active)",
							borderRadius: "var(--radius-md)",
							color: "var(--text)",
							fontSize: "14px",
							fontWeight: 500,
							cursor: setConsent.isPending ? "not-allowed" : "pointer",
							opacity: setConsent.isPending ? 0.6 : 1,
							transition: "background var(--transition-fast)",
						}}
					>
						Allow
					</button>
				</div>
				{setConsent.error && (
					<p style={{ color: "var(--term-red)", fontSize: "13px", margin: 0 }}>
						{setConsent.error.message}
					</p>
				)}
			</div>
		</div>
	);
}
