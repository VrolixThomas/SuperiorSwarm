import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Uncaught render error:", error, info.componentStack);
	}

	render() {
		if (!this.state.hasError) return this.props.children;

		const { error } = this.state;

		return (
			<div
				className="flex h-full w-full items-center justify-center"
				style={{ background: "var(--bg-base)" }}
			>
				<div className="flex max-w-lg flex-col items-center gap-5 px-6 text-center">
					<span
						className="text-2xl font-bold"
						style={{ color: "var(--accent)", fontFamily: "monospace" }}
					>
						{">"}_
					</span>

					<h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
						Something went wrong
					</h1>

					<p className="text-sm" style={{ color: "var(--text-secondary)" }}>
						The application encountered an unexpected error. You can reload to get back on track.
					</p>

					<button
						type="button"
						onClick={() => window.location.reload()}
						className="cursor-pointer border-none px-5 py-2 text-sm font-medium text-white"
						style={{
							background: "var(--accent)",
							borderRadius: "var(--radius-md)",
						}}
					>
						Reload
					</button>

					{error && (
						<details className="w-full text-left">
							<summary className="cursor-pointer text-xs" style={{ color: "var(--text-tertiary)" }}>
								Error details
							</summary>
							<pre
								className="mt-2 max-h-48 overflow-auto rounded p-3 text-xs"
								style={{
									background: "var(--bg-surface)",
									color: "var(--text-tertiary)",
									fontFamily: "monospace",
								}}
							>
								{error.name}: {error.message}
								{error.stack && `\n\n${error.stack}`}
							</pre>
						</details>
					)}
				</div>
			</div>
		);
	}
}
