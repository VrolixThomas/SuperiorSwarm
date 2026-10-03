import { trpc } from "../../trpc/client";
import { SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

export function KeepAwakeSettings() {
	const utils = trpc.useUtils();
	const query = trpc.settings.getKeepAwake.useQuery(undefined, { refetchInterval: 2_000 });
	const mutation = trpc.settings.setKeepAwake.useMutation({
		onSuccess: (state) => utils.settings.getKeepAwake.setData(undefined, state),
		onSettled: () => utils.settings.getKeepAwake.invalidate(),
	});
	const state = query.data;
	const busy = mutation.isPending || state?.busy;
	const error = mutation.error?.message ?? query.error?.message ?? state?.error;

	return (
		<>
			<SectionLabel>Mac sleep</SectionLabel>
			<div className="mb-6 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<ToggleRow
					label="Keep running with the lid closed"
					description="Keep your Mac awake so terminal commands and agents can continue while your MacBook lid is closed. Off by default."
					checked={state?.enabled ?? false}
					disabled={!state?.supported || Boolean(busy)}
					onChange={() => mutation.mutate(!state?.enabled)}
				/>
				<div className="space-y-2 border-t border-[var(--border)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
					<p>
						macOS asks for administrator approval when you enable this. It prevents sleep for the
						whole Mac, on battery or power, including idle and Apple menu sleep. Your display can
						still turn off. Lock your Mac before leaving it unattended.
					</p>
					<p>
						Uses more energy and can drain your battery and generate heat. Keep your Mac on a hard,
						ventilated surface, never in a bag or sleeve while enabled. Connecting power is
						recommended for long tasks.
					</p>
					<p>
						Turn this off or quit SuperiorSwarm to restore normal sleep settings. If the lid is
						already closed, you may need to reopen and close it to trigger sleep. Enable this again
						after relaunching; closing the app window is OK. Agent sleep rules below still apply,
						and tasks that need input will still wait for you.
					</p>
					{state && !state.supported && <p>Available on macOS only.</p>}
					<output className="block text-[var(--text-secondary)]">
						{busy
							? "Updating… Complete the macOS approval prompt if shown."
							: state?.enabled
								? "On — your Mac is being kept awake."
								: "Off — SuperiorSwarm is not preventing Mac sleep."}
					</output>
					{error && (
						<p role="alert" className="text-[var(--color-danger)]">
							{error}
						</p>
					)}
				</div>
			</div>
		</>
	);
}
