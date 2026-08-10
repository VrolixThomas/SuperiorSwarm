import type { HermesPendingInteraction } from "../../hermes/hermes-view-model";

export function HermesApprovalCard({
	interaction,
	pending,
	onChoose,
}: {
	interaction: HermesPendingInteraction;
	pending: boolean;
	onChoose: (choice: string) => void;
}) {
	return (
		<div className="mb-2 rounded-[7px] border border-[#ffd60a]/30 bg-[#ffd60a]/5 p-2">
			<div className="whitespace-pre-wrap break-words text-[11px] text-[var(--text-secondary)]">
				{interaction.prompt}
			</div>
			<div className="mt-2 flex flex-wrap gap-2">
				{interaction.choices.map((choice, index) => (
					<button
						type="button"
						key={`${choice.value}:${index}`}
						disabled={pending}
						onClick={() => onChoose(choice.value)}
						className={
							index === 0
								? "rounded-[5px] bg-[var(--accent)] px-2 py-1 text-[11px] text-white disabled:opacity-40"
								: "rounded-[5px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] disabled:opacity-40"
						}
					>
						{choice.label}
					</button>
				))}
			</div>
		</div>
	);
}

export function HermesClarificationChoices({
	choices,
	pending,
	onChoose,
}: {
	choices: HermesPendingInteraction["choices"];
	pending: boolean;
	onChoose: (answer: string) => void;
}) {
	if (choices.length === 0) return null;
	return (
		<div className="mb-2 flex flex-wrap gap-1.5">
			{choices.map((choice, index) => (
				<button
					type="button"
					key={`${choice.value}:${index}`}
					disabled={pending}
					onClick={() => onChoose(choice.value)}
					className="rounded-[5px] border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] disabled:opacity-40"
				>
					{choice.label}
				</button>
			))}
		</div>
	);
}
