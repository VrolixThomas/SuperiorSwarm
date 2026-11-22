import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { resolveBrowserAddress } from "../../shared/browser-address";
import type { TabItem } from "../stores/tab-store";
import { BrowserFailure } from "./BrowserFailure";
import { browserRegistry } from "./runtime-registry";

export function BrowserTab({ tab }: { tab: Extract<TabItem, { kind: "browser" }> }) {
	const subscribe = useCallback(
		(notify: () => void) => browserRegistry.subscribe(tab.id, notify),
		[tab.id]
	);
	const snapshot = useCallback(() => browserRegistry.getState(tab.id), [tab.id]);
	const state = useSyncExternalStore(subscribe, snapshot);
	const host = useRef<HTMLDivElement>(null);
	const addressRef = useRef<HTMLInputElement>(null);
	const composing = useRef(false);
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const tabRef = useRef(tab);
	tabRef.current = tab;
	useLayoutEffect(() => {
		if (!host.current) return;
		return browserRegistry.attach(
			{
				workspaceId: tab.workspaceId,
				browserId: tab.id,
				url: tabRef.current.url,
				viewport: tabRef.current.viewport,
			},
			host.current
		);
	}, [tab.id, tab.workspaceId]);
	const overlay = browserRegistry.getOverlay(tab.id);
	const navigate = (value: string) => {
		try {
			const url = resolveBrowserAddress(value);
			if (!url) return;
			setDraft(null);
			setError(null);
			addressRef.current?.blur();
			void browserRegistry.command(tab.id, { kind: "navigate", url });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Invalid address.");
		}
	};
	const recover = () => {
		setError(null);
		if (state?.phase === "crashed") void browserRegistry.restart(tab.id);
		else void browserRegistry.command(tab.id, { kind: "reload" });
	};
	const buttonClass =
		"shrink-0 rounded px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] disabled:opacity-30";
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]"
			aria-label="Workspace browser"
		>
			<form
				className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 text-xs"
				onSubmit={(event) => {
					event.preventDefault();
					if (composing.current) return;
					navigate(draft ?? state?.url ?? tab.url);
				}}
			>
				<button
					type="button"
					className={buttonClass}
					aria-label="Back"
					disabled={!state?.canGoBack}
					onClick={() => void browserRegistry.command(tab.id, { kind: "back" })}
				>
					←
				</button>
				<button
					type="button"
					className={buttonClass}
					aria-label="Forward"
					disabled={!state?.canGoForward}
					onClick={() => void browserRegistry.command(tab.id, { kind: "forward" })}
				>
					→
				</button>
				<button
					type="button"
					className={buttonClass}
					aria-label={state?.loading ? "Stop loading" : "Reload"}
					onClick={() =>
						void browserRegistry.command(tab.id, { kind: state?.loading ? "stop" : "reload" })
					}
				>
					{state?.loading ? "×" : "↻"}
				</button>
				<input
					ref={addressRef}
					data-browser-address={tab.id}
					aria-label="Search or enter address"
					placeholder="Search Google or enter address"
					title="Search Google or enter a website or localhost address"
					value={draft ?? state?.url ?? tab.url}
					onChange={(event) => setDraft(event.target.value)}
					onFocus={(event) => {
						const input = event.currentTarget;
						setDraft(input.value);
						queueMicrotask(() => {
							if (document.activeElement === input) input.select();
						});
					}}
					onBlur={() => setDraft(null)}
					onCompositionStart={() => {
						composing.current = true;
					}}
					onCompositionEnd={() => {
						composing.current = false;
					}}
					onKeyDown={(event) => {
						if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
							if (event.key === "Enter") event.preventDefault();
							return;
						}
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setDraft(null);
							setError(null);
							event.currentTarget.blur();
						}
					}}
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					className="min-w-[120px] flex-1 rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
				/>
				<select
					aria-label="Preview viewport"
					value={state?.viewport ?? tab.viewport}
					onChange={(event) =>
						void browserRegistry.command(tab.id, {
							kind: "viewport",
							viewport: event.target.value as "desktop" | "phone",
						})
					}
					className="max-w-24 rounded bg-[var(--bg-elevated)] p-1 text-[var(--text-secondary)]"
				>
					<option value="desktop">Desktop</option>
					<option value="phone">Phone</option>
				</select>
				<button
					type="button"
					className={buttonClass}
					aria-label={state?.agentControl ? "Pause agent control" : "Resume agent control"}
					disabled={!state}
					onClick={() =>
						void browserRegistry.command(tab.id, {
							kind: "agent-control",
							enabled: !state?.agentControl,
						})
					}
				>
					{state?.agentControl ? "Pause agent" : "Resume agent"}
				</button>
				<button
					type="button"
					className={buttonClass}
					aria-label="Clear workspace browsing data"
					title="Clear cookies and website data for this workspace"
					disabled={!state || state.phase !== "ready"}
					onClick={() => void browserRegistry.command(tab.id, { kind: "clear-data" })}
				>
					Clear data
				</button>
				<button
					type="button"
					className={buttonClass}
					aria-label="Open in external browser"
					disabled={!state?.url}
					onClick={() => {
						if (state?.url) void window.electron.shell.openExternal(state.url);
					}}
				>
					↗
				</button>
			</form>
			{error && (
				<p role="alert" className="px-3 py-2 text-xs text-[var(--term-red)]">
					{error}
				</p>
			)}
			<div ref={host} data-browser-slot={tab.id} className="min-h-0 flex-1" aria-label="Web page" />
			{overlay &&
				(state?.loadError || state?.phase === "crashed" || (!state?.url && !state?.loading)) &&
				createPortal(
					<div className="pointer-events-auto flex h-full w-full bg-[var(--bg-base)]">
						{state?.loadError ? (
							<BrowserFailure failure={state.loadError} onRetry={recover} onNavigate={navigate} />
						) : state?.phase === "crashed" ? (
							<div role="alert" className="m-auto p-6 text-sm text-[var(--text-secondary)]">
								<p>{state.error}</p>
								<button type="button" onClick={recover} className="mt-3 underline">
									Reopen browser
								</button>
							</div>
						) : (
							<div className="m-auto p-6 text-center text-[var(--text-tertiary)]">
								<p className="text-sm">Search the web, open a website or your local app</p>
								<p className="mt-2 text-xs">Sign-ins are saved separately for this workspace.</p>
							</div>
						)}
					</div>,
					overlay
				)}
		</section>
	);
}
