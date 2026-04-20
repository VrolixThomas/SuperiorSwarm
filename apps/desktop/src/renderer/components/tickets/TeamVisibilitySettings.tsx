import { useCallback, useRef, useState } from "react";
import type { TicketTeam } from "../../../shared/tickets";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { trpc } from "../../trpc/client";
import { CheckboxRow } from "../ui/CheckboxRow";

interface TeamVisibilitySettingsProps {
	teams: TicketTeam[];
}

export function TeamVisibilitySettings({ teams }: TeamVisibilitySettingsProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const utils = trpc.useUtils();
	const close = useCallback(() => setOpen(false), []);
	useClickOutside(ref, close, open);
	useEscapeKey(close, open);

	const { data: visibleTeams } = trpc.tickets.getVisibleTeams.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});

	const setMutation = trpc.tickets.setVisibleTeams.useMutation({
		onSuccess: () => {
			utils.tickets.getVisibleTeams.invalidate();
			utils.tickets.getCachedTickets.invalidate();
		},
	});

	const isVisible = (team: TicketTeam) => {
		if (!visibleTeams) return true;
		return visibleTeams.some((v) => v.provider === team.provider && v.id === team.id);
	};

	const toggle = (team: TicketTeam) => {
		const current = visibleTeams ?? teams.map((t) => ({ provider: t.provider, id: t.id }));
		const isOn = current.some((v) => v.provider === team.provider && v.id === team.id);
		const next = isOn
			? current.filter((v) => !(v.provider === team.provider && v.id === team.id))
			: [...current, { provider: team.provider, id: team.id }];
		setMutation.mutate({ teams: next.length > 0 ? next : null });
	};

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				title="Team visibility"
				className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
			>
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<circle cx="8" cy="3.5" r="1.5" fill="currentColor" />
					<circle cx="8" cy="8" r="1.5" fill="currentColor" />
					<circle cx="8" cy="12.5" r="1.5" fill="currentColor" />
				</svg>
			</button>
			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 w-[220px] rounded-[8px] border border-[var(--border)] bg-[var(--bg-overlay)] py-1 shadow-xl">
					<div className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
						Visible teams
					</div>
					{teams.map((team) => (
						<CheckboxRow
							key={`${team.provider}:${team.id}`}
							checked={isVisible(team)}
							onClick={() => toggle(team)}
							label={team.name}
							meta={team.provider === "linear" ? "Linear" : "Jira"}
						/>
					))}
				</div>
			)}
		</div>
	);
}
