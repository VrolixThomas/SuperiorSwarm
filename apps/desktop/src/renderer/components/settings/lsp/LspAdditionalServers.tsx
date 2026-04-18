import { useMemo } from "react";
import type { LanguageServerConfig } from "../../../../shared/lsp-schema";
import type { LspHealthEntry } from "../../../../shared/types";
import { SectionLabel } from "../SectionHeading";
import { LspServerRow } from "./LspServerRow";

interface ConfigWithScope {
	config: LanguageServerConfig;
	scope: "user" | "repo";
}

interface LspAdditionalServersProps {
	servers: ConfigWithScope[];
	healthEntries: LspHealthEntry[];
	onEdit: (config: LanguageServerConfig, scope: "user" | "repo") => void;
	onRemove: (id: string, scope: "user" | "repo") => void;
	onAdd: () => void;
	removing: string | null;
	onRecheck?: (id: string) => void;
	onAskAgent?: (id: string) => void;
	onTest?: (
		id: string
	) => Promise<
		{ ok: true; capabilities: unknown; serverInfo: unknown } | { ok: false; error: string }
	>;
	rechecking?: string | null;
	askingAgent?: string | null;
	conflicts?: Map<string, { overlappingWith: string[] }>;
	onMove?: (id: string, scope: "user" | "repo", direction: "up" | "down") => void;
}

export function LspAdditionalServers({
	servers,
	healthEntries,
	onEdit,
	onRemove,
	onAdd,
	removing,
	onRecheck,
	onAskAgent,
	onTest,
	rechecking,
	askingAgent,
	conflicts,
	onMove,
}: LspAdditionalServersProps) {
	const healthMap = useMemo(() => new Map(healthEntries.map((e) => [e.id, e])), [healthEntries]);

	const scopeLayout = useMemo(() => {
		const scopedCounts = { user: 0, repo: 0 };
		const scopedIndices = new Map<string, number>();
		for (const { config, scope } of servers) {
			scopedIndices.set(`${scope}:${config.id}`, scopedCounts[scope]);
			scopedCounts[scope]++;
		}
		return { scopedCounts, scopedIndices };
	}, [servers]);

	return (
		<div className="mb-6">
			<div className="mb-2.5 flex items-center justify-between">
				<SectionLabel>Additional Servers</SectionLabel>
				<button
					type="button"
					onClick={onAdd}
					className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]"
				>
					+ Add Server
				</button>
			</div>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				{servers.length === 0 ? (
					<div className="px-4 py-8 text-center text-[12px] text-[var(--text-quaternary)]">
						No additional servers configured. Click + Add Server to get started.
					</div>
				) : (
					servers.map(({ config, scope }, index) => {
						const health = healthMap.get(config.id);
						const isRemoving = removing === config.id;
						const conflict = conflicts?.get(config.id);
						const scopedIndex = scopeLayout.scopedIndices.get(`${scope}:${config.id}`) ?? -1;
						const scopedCount = scopeLayout.scopedCounts[scope];
						const canMoveUp = onMove != null && scopedIndex > 0;
						const canMoveDown = onMove != null && scopedIndex < scopedCount - 1;

						return (
							<div
								key={`${scope}-${config.id}`}
								className={index > 0 ? "border-t border-[var(--border-subtle)]" : ""}
							>
								<LspServerRow
									name={config.id}
									command={`${config.command} ${config.args.join(" ")}`.trim()}
									available={health?.available ?? false}
									startupError={health?.lastStartupError}
									healthEntry={health}
									onRecheck={onRecheck ? () => onRecheck(config.id) : undefined}
									onAskAgent={onAskAgent ? () => onAskAgent(config.id) : undefined}
									onTest={onTest ? () => onTest(config.id) : undefined}
									rechecking={rechecking === config.id}
									askingAgent={askingAgent === config.id}
									overlappingWith={conflict?.overlappingWith}
									rightSlot={
										<div className="flex items-center gap-2">
											<span
												className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
													scope === "user"
														? "bg-[rgba(100,100,255,0.15)] text-[#8888ff]"
														: "bg-[rgba(255,159,10,0.15)] text-[#ff9f0a]"
												}`}
											>
												{scope === "user" ? "Global" : "This Repo"}
											</span>
											{onMove && (
												<div className="flex flex-col">
													<button
														type="button"
														disabled={!canMoveUp}
														onClick={() => onMove(config.id, scope, "up")}
														className="rounded px-1 text-[8px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-30"
														title="Move up (higher precedence)"
													>
														▲
													</button>
													<button
														type="button"
														disabled={!canMoveDown}
														onClick={() => onMove(config.id, scope, "down")}
														className="rounded px-1 text-[8px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-30"
														title="Move down (lower precedence)"
													>
														▼
													</button>
												</div>
											)}
											<button
												type="button"
												onClick={() => onEdit(config, scope)}
												className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
											>
												Edit
											</button>
											<button
												type="button"
												disabled={isRemoving}
												onClick={() => onRemove(config.id, scope)}
												className="rounded border border-[rgba(255,69,58,0.3)] px-2 py-0.5 text-[10px] text-[#ff453a] hover:bg-[rgba(255,69,58,0.1)] disabled:opacity-50"
											>
												Remove
											</button>
										</div>
									}
								/>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
