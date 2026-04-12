import type { LspHealthEntry } from "../../../../shared/types";
import type { LanguageServerConfig } from "../../../../shared/lsp-types";
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
}

export function LspAdditionalServers({
	servers,
	healthEntries,
	onEdit,
	onRemove,
	onAdd,
	removing,
}: LspAdditionalServersProps) {
	const healthMap = new Map(healthEntries.map((e) => [e.id, e]));

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

						return (
							<div
								key={`${scope}-${config.id}`}
								className={index > 0 ? "border-t border-[var(--border-subtle)]" : ""}
							>
								<LspServerRow
									name={config.id}
									command={`${config.command} ${config.args.join(" ")}`.trim()}
									available={health?.available ?? false}
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
