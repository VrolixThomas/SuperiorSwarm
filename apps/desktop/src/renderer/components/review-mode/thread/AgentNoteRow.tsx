import type { AgentThreadNote, CodeReference } from "../../../../shared/review-path-types";

export function AgentNoteRow({
	note,
	onReference,
}: { note: AgentThreadNote; onReference?: (ref: CodeReference) => void }) {
	return (
		<div className="mx-3 mb-2 rounded-md bg-[var(--bg-elevated)] p-2 text-[12px] text-[var(--text-secondary)]">
			<span className="mr-2 text-[11px] text-[var(--text-tertiary)]">Agent · {note.verdict}</span>
			{note.text}
			{note.refs?.map((ref) => (
				<button
					type="button"
					key={`${ref.path}:${ref.line}`}
					disabled={!onReference}
					onClick={() => onReference?.(ref)}
					className="ml-2 max-w-full truncate font-mono text-[11px] text-[var(--accent-hover)]"
				>
					{ref.path.split("/").pop()}:{ref.line}
				</button>
			))}
		</div>
	);
}
