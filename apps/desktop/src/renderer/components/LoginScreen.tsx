import { trpc } from "@/trpc/client";
import type { ReactNode } from "react";
import { PRIVACY_URL, TERMS_URL } from "../../shared/telemetry";

type OAuthProvider = "github" | "google" | "apple";

const providers: { id: OAuthProvider; label: string; icon: ReactNode }[] = [
	{
		id: "github",
		label: "Sign in with GitHub",
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
			</svg>
		),
	},
	{
		id: "apple",
		label: "Sign in with Apple",
		icon: (
			<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
			</svg>
		),
	},
	// TODO: enable once Google OAuth is configured in Supabase
	// {
	// 	id: "google",
	// 	label: "Sign in with Google",
	// 	icon: (
	// 		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
	// 			<path
	// 				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
	// 				fill="#4285F4"
	// 			/>
	// 			<path
	// 				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
	// 				fill="#34A853"
	// 			/>
	// 			<path
	// 				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
	// 				fill="#FBBC05"
	// 			/>
	// 			<path
	// 				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
	// 				fill="#EA4335"
	// 			/>
	// 		</svg>
	// 	),
	// },
];

export function LoginScreen() {
	const signIn = trpc.auth.signIn.useMutation();
	const utils = trpc.useUtils();

	const handleSignIn = (provider: OAuthProvider) => {
		signIn.mutate(
			{ provider },
			{
				onSuccess: (result) => {
					if (result.success) {
						utils.auth.getSession.invalidate();
					}
				},
			}
		);
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
			}}
		>
			<h1
				style={{
					fontSize: "24px",
					fontWeight: 600,
					color: "var(--text)",
					marginBottom: "8px",
				}}
			>
				SuperiorSwarm
			</h1>
			<p
				style={{
					fontSize: "14px",
					color: "var(--text-tertiary)",
					marginBottom: "24px",
				}}
			>
				Sign in to continue
			</p>

			{providers.map(({ id, label, icon }) => (
				<button
					key={id}
					type="button"
					onClick={() => handleSignIn(id)}
					disabled={signIn.isPending}
					style={{
						display: "flex",
						alignItems: "center",
						gap: "10px",
						padding: "10px 24px",
						minWidth: "260px",
						background: "var(--bg-elevated)",
						border: "1px solid var(--border-active)",
						borderRadius: "var(--radius-md)",
						color: "var(--text)",
						fontSize: "14px",
						fontWeight: 500,
						cursor: signIn.isPending ? "not-allowed" : "pointer",
						opacity: signIn.isPending ? 0.6 : 1,
						transition: "background var(--transition-fast)",
					}}
					onMouseEnter={(e) => {
						if (!signIn.isPending) e.currentTarget.style.background = "var(--bg-overlay)";
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = "var(--bg-elevated)";
					}}
				>
					{icon}
					{label}
				</button>
			))}

			{signIn.error && (
				<p style={{ color: "var(--term-red)", fontSize: "13px", marginTop: "8px" }}>
					{signIn.error.message}
				</p>
			)}
			{signIn.data && !signIn.data.success && signIn.data.error && (
				<p style={{ color: "var(--term-red)", fontSize: "13px", marginTop: "8px" }}>
					{signIn.data.error}
				</p>
			)}

			<p
				style={{
					fontSize: "12px",
					color: "var(--text-quaternary)",
					marginTop: "16px",
				}}
			>
				By continuing you agree to our{" "}
				<a
					href={TERMS_URL}
					target="_blank"
					rel="noopener noreferrer"
					style={{ color: "var(--text-tertiary)", textDecoration: "underline" }}
				>
					terms
				</a>
				{" "}and{" "}
				<a
					href={PRIVACY_URL}
					target="_blank"
					rel="noopener noreferrer"
					style={{ color: "var(--text-tertiary)", textDecoration: "underline" }}
				>
					privacy notice
				</a>
				.
			</p>
		</div>
	);
}
