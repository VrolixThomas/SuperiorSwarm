import type { LspHealthEntry } from "../../../../shared/types";
import { SectionLabel } from "../SectionHeading";
import { LspServerRow } from "./LspServerRow";

const BUILT_IN_SERVERS = [
	{ id: "typescript", displayName: "TypeScript / JavaScript" },
	{ id: "python", displayName: "Python" },
	{ id: "go", displayName: "Go" },
	{ id: "rust", displayName: "Rust" },
	{ id: "java", displayName: "Java" },
	{ id: "cpp", displayName: "C / C++" },
	{ id: "php", displayName: "PHP" },
	{ id: "ruby", displayName: "Ruby" },
] as const;

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
				{BUILT_IN_SERVERS.map((server, index) => {
					const health = healthMap.get(server.id);
					const isDisabled = disabledIds.has(server.id);
					const isToggling = toggling === server.id;

					return (
						<div
							key={server.id}
							className={index > 0 ? "border-t border-[var(--border-subtle)]" : ""}
						>
							<LspServerRow
								name={server.displayName}
								command={health?.command ?? server.id}
								available={health?.available ?? false}
								dimmed={isDisabled}
								rightSlot={
									<button
										type="button"
										disabled={isToggling}
										onClick={() => onToggle(server.id, isDisabled)}
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
