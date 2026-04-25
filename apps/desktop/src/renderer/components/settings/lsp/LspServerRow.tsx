import { useState } from "react";
import type { LspHealthEntry } from "../../../../shared/types";
import { LspInstallCard } from "./LspInstallCard";

interface LspServerRowProps {
	name: string;
	command: string;
	available: boolean;
	startupError?: string;
	dimmed?: boolean;
	rightSlot: React.ReactNode;
	healthEntry?: LspHealthEntry;
	onRecheck?: () => void;
	onAskAgent?: () => void;
	onTest?: () => Promise<
		{ ok: true; capabilities: unknown; serverInfo: unknown } | { ok: false; error: string }
	>;
	rechecking?: boolean;
	askingAgent?: boolean;
	overlappingWith?: string[];
}

export function LspServerRow({
	name,
	command,
	available,
	startupError,
	dimmed,
	rightSlot,
	healthEntry,
	onRecheck,
	onAskAgent,
	onTest,
	rechecking,
	askingAgent,
	overlappingWith,
}: LspServerRowProps) {
	const [testState, setTestState] = useState<
		| { status: "idle" }
		| { status: "running" }
		| { status: "ok"; capabilityCount: number; serverInfo: unknown }
		| { status: "error"; message: string }
	>({ status: "idle" });

	const runTest = async () => {
		if (!onTest) return;
		setTestState({ status: "running" });
		const result = await onTest();
		if (result.ok) {
			const caps = (result.capabilities as Record<string, unknown> | null) ?? {};
			setTestState({
				status: "ok",
				capabilityCount: Object.keys(caps).length,
				serverInfo: result.serverInfo,
			});
		} else {
			setTestState({ status: "error", message: result.error });
		}
	};
	return (
		<div
			className="flex items-start justify-between gap-3 px-4 py-3"
			style={dimmed ? { opacity: 0.5 } : undefined}
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-[13px] font-medium text-[var(--text)]">{name}</span>
					<span
						className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
							available
								? "bg-[var(--success-subtle)] text-[var(--color-success)]"
								: "bg-[var(--warning-subtle)] text-[var(--color-warning)]"
						}`}
					>
						{available ? "Installed" : "Missing"}
					</span>
				</div>
				<div className="truncate font-mono text-[10px] text-[var(--text-quaternary)]">
					{command}
				</div>
				{overlappingWith && overlappingWith.length > 0 && (
					<div
						className="mt-1 text-[10px] text-[var(--color-warning)]"
						title="Earlier-listed server wins. Reorder to change precedence."
					>
						Overlaps with: {overlappingWith.join(", ")}
					</div>
				)}
				{!available && healthEntry && (
					<LspInstallCard
						entry={healthEntry}
						onRecheck={onRecheck}
						onAskAgent={onAskAgent}
						rechecking={rechecking}
						askingAgent={askingAgent}
					/>
				)}
				{startupError && (
					<div className="mt-1 max-h-[60px] overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--color-danger)]">
						{startupError}
					</div>
				)}
				{testState.status === "ok" && (
					<div className="mt-1 text-[10px] text-[var(--color-success)]">
						Test passed — {testState.capabilityCount} capabilities
						{typeof testState.serverInfo === "object" &&
						testState.serverInfo !== null &&
						"name" in testState.serverInfo
							? ` · ${String((testState.serverInfo as { name: unknown }).name)}`
							: ""}
					</div>
				)}
				{testState.status === "error" && (
					<div className="mt-1 font-mono text-[10px] text-[var(--color-danger)]">
						Test failed: {testState.message}
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{onTest && available && (
					<button
						type="button"
						onClick={runTest}
						disabled={testState.status === "running"}
						className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-40"
					>
						{testState.status === "running" ? "Testing…" : "Test"}
					</button>
				)}
				{rightSlot}
			</div>
		</div>
	);
}
