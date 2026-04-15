import { BUILT_IN_SERVER_DISPLAY, BUILT_IN_SERVER_IDS } from "../../../../shared/lsp-builtin-ids";
import type { LspHealthEntry } from "../../../../shared/types";
import { SectionLabel } from "../SectionHeading";
import { LspServerRow } from "./LspServerRow";

interface LspBuiltInServersProps {
	healthEntries: LspHealthEntry[];
	disabledIds: Set<string>;
	onToggle: (id: string, enabled: boolean) => void;
	toggling: string | null;
}

export function LspBuiltInServers({
	healthEntries,
	disabledIds,
	onToggle,
	toggling,
}: LspBuiltInServersProps) {
	const healthMap = new Map(healthEntries.map((e) => [e.id, e]));

	return (
		<div className="mb-6">
			<SectionLabel>Built-in Servers</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				{BUILT_IN_SERVER_IDS.map((id, index) => {
					const health = healthMap.get(id);
					const isDisabled = disabledIds.has(id);
					const isToggling = toggling === id;
					const displayName = BUILT_IN_SERVER_DISPLAY[id] ?? id;

					return (
						<div key={id} className={index > 0 ? "border-t border-[var(--border-subtle)]" : ""}>
							<LspServerRow
								name={displayName}
								command={health?.command ?? id}
								available={health?.available ?? false}
								installHint={health?.installHint}
								startupError={health?.lastStartupError}
								dimmed={isDisabled}
								rightSlot={
									<button
										type="button"
										disabled={isToggling}
										onClick={() => onToggle(id, isDisabled)}
										className="relative h-5 w-9 rounded-full transition-colors"
										style={{
											background: isDisabled ? "#555" : "#30d158",
											opacity: isToggling ? 0.5 : 1,
										}}
									>
										<div
											className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left]"
											style={{ left: isDisabled ? "2px" : "18px" }}
										/>
									</button>
								}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}
