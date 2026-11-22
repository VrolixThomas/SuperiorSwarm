import type * as monaco from "monaco-editor";
import { detectLanguage } from "../../../../shared/diff-types";
import type { PRContext } from "../../../../shared/github-types";
import type { CodeReference, ContextFileStep } from "../../../../shared/review-path-types";
import { ContextEditor } from "./ContextEditor";
import { StepHeader } from "./StepHeader";
import { useContextContent } from "./useContextContent";

export interface ContextFileViewProps {
	prCtx: PRContext;
	workspaceId?: string;
	baseRef?: string;
	step: ContextFileStep;
	headRef?: string;
	onPrevious?: () => void;
	onNext?: () => void;
	onRemove?: () => void;
	onAddToPath?: (path: string) => void;
	onOpenReference?: (ref: CodeReference) => void;
	/** Changed path → its step number, used for call-site labels. */
	stepNumbers?: Map<string, number>;
	onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
}
export function ContextFileView({
	prCtx,
	workspaceId,
	baseRef,
	step,
	headRef,
	onPrevious,
	onNext,
	onRemove,
	onAddToPath,
	onOpenReference,
	stepNumbers,
	onEditorReady,
}: ContextFileViewProps) {
	const { content, message } = useContextContent(workspaceId, prCtx, step.path, baseRef, headRef);
	const action = onRemove ? (
		<button
			type="button"
			onClick={onRemove}
			className="shrink-0 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text)]"
		>
			Remove from path
		</button>
	) : onAddToPath ? (
		<button
			type="button"
			onClick={() => onAddToPath(step.path)}
			className="shrink-0 text-[12px] text-[var(--accent-hover)]"
		>
			Add to path
		</button>
	) : undefined;
	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden">
			<StepHeader
				label="Context"
				filePath={step.path}
				context
				note={step.note}
				detail={step.detail}
				onPrevious={onPrevious}
				onNext={onNext}
				action={action}
			/>
			<div className="relative min-h-0 flex-1">
				<div className={`h-full ${message ? "invisible" : ""}`} aria-hidden={!!message}>
					<ContextEditor
						content={message ? "" : content}
						language={detectLanguage(step.path)}
						filePath={step.path}
						repoPath={prCtx.repoPath}
						focus={step.focus}
						onOpenReference={onOpenReference}
						onEditorReady={message ? undefined : onEditorReady}
					/>
				</div>
				{message && (
					<output className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
						{message}
					</output>
				)}
			</div>
			{!!step.usedBy?.length && (
				<div className="max-h-[30%] shrink-0 overflow-y-auto px-6 py-4">
					<h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
						Used by
					</h3>
					{step.usedBy.map((ref) => {
						const number = stepNumbers?.get(ref.path);
						return (
							<div
								key={`${ref.path}:${ref.line}`}
								className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--bg-surface)]"
							>
								<button
									type="button"
									title={ref.path}
									onClick={() => onOpenReference?.(ref)}
									disabled={!onOpenReference}
									className="shrink-0 font-mono text-[12px] text-[var(--text)]"
								>
									{ref.path.split("/").pop()}:{ref.line}
								</button>
								<span className="min-w-0 flex-1 text-[12px] text-[var(--text-secondary)]">
									{ref.description}
								</span>
								{number ? (
									<button
										type="button"
										onClick={() => onOpenReference?.(ref)}
										disabled={!onOpenReference}
										className="shrink-0 text-[11px] text-[var(--text-tertiary)]"
									>
										step {number} · changed
									</button>
								) : (
									onAddToPath && (
										<button
											type="button"
											onClick={() => onAddToPath(ref.path)}
											className="shrink-0 text-[12px] text-[var(--accent-hover)]"
										>
											Add to path
										</button>
									)
								)}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
