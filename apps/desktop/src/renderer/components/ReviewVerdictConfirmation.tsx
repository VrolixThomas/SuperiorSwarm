import { useState } from "react";

interface ReviewVerdictConfirmationProps {
	onSubmit: (verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES", body: string) => void;
	onCancel: () => void;
	isSubmitting: boolean;
}

type Verdict = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export function ReviewVerdictConfirmation({
	onSubmit,
	onCancel,
	isSubmitting,
}: ReviewVerdictConfirmationProps) {
	const [selected, setSelected] = useState<Verdict | null>(null);
	const [body, setBody] = useState("");

	return (
		<div className="border-t border-[var(--border-subtle)] px-7 py-3">
			<div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-tertiary)] mb-[8px]">
				Submit review
			</div>
			<div className="flex gap-[6px] mb-[10px]">
				<button
					type="button"
					onClick={() => setSelected("COMMENT")}
					className={[
						"flex-1 py-[5px] px-[10px] rounded-[6px] text-[11px] font-medium cursor-pointer",
						selected === "COMMENT"
							? "bg-[var(--bg-active)] text-[var(--text-secondary)] border border-[var(--border-default)]"
							: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)]",
					].join(" ")}
				>
					Comment
				</button>
				<button
					type="button"
					onClick={() => setSelected("APPROVE")}
					className={[
						"flex-1 py-[5px] px-[10px] rounded-[6px] text-[11px] font-medium cursor-pointer",
						selected === "APPROVE"
							? "bg-[rgba(48,209,88,0.18)] text-[var(--success)] border border-[rgba(48,209,88,0.25)]"
							: "bg-[var(--success-subtle)] text-[var(--success)] border border-[rgba(48,209,88,0.25)]",
					].join(" ")}
				>
					Approve
				</button>
				<button
					type="button"
					onClick={() => setSelected("REQUEST_CHANGES")}
					className={[
						"flex-1 py-[5px] px-[10px] rounded-[6px] text-[11px] font-medium cursor-pointer",
						selected === "REQUEST_CHANGES"
							? "bg-[rgba(255,69,58,0.18)] text-[var(--danger)] border border-[rgba(255,69,58,0.25)]"
							: "bg-[var(--danger-subtle)] text-[var(--danger)] border border-[rgba(255,69,58,0.25)]",
					].join(" ")}
				>
					Request Changes
				</button>
			</div>
			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder="Optional review body..."
				className="w-full min-h-[60px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] font-[var(--font-family)] resize-y mb-[10px]"
			/>
			<div className="flex justify-end gap-[6px]">
				<button
					type="button"
					onClick={onCancel}
					disabled={isSubmitting}
					className="px-[14px] py-[5px] rounded-[6px] text-[11px] font-medium text-[var(--text-secondary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={() => selected && onSubmit(selected, body)}
					disabled={!selected || isSubmitting}
					className={[
						"px-[14px] py-[5px] rounded-[6px] text-[11px] font-semibold border-none",
						selected && !isSubmitting
							? "cursor-pointer bg-[var(--accent)] text-white"
							: "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-tertiary)]",
					].join(" ")}
				>
					{isSubmitting ? "Submitting..." : "Submit Review"}
				</button>
			</div>
		</div>
	);
}
