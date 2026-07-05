import type { GitHubPRFile } from "../../../../shared/github-types";

interface FileSectionProps {
	files: GitHubPRFile[];
	viewedFiles: Set<string>;
	commentCountByFile: Map<string, number>;
	activeFilePath: string | null;
	onSelectFile: (path: string) => void;
	onToggleViewed: (path: string, viewed: boolean) => void;
}

const CHANGE_TYPE_DOT: Record<GitHubPRFile["changeType"], string> = {
	ADDED: "bg-[var(--term-green)]",
	MODIFIED: "bg-[var(--term-yellow)]",
	CHANGED: "bg-[var(--term-yellow)]",
	DELETED: "bg-[var(--term-red)]",
	RENAMED: "bg-[var(--accent)]",
	COPIED: "bg-[var(--accent)]",
	UNCHANGED: "bg-[var(--text-quaternary)]",
};

function splitPath(path: string): { directory: string; filename: string } {
	const idx = path.lastIndexOf("/");
	if (idx === -1) return { directory: "", filename: path };
	return {
		directory: path.slice(0, idx + 1),
		filename: path.slice(idx + 1),
	};
}

export function FileSection({
	files,
	viewedFiles,
	commentCountByFile,
	activeFilePath,
	onSelectFile,
	onToggleViewed,
}: FileSectionProps) {
	const viewedCount = files.reduce(
		(count, file) => count + (viewedFiles.has(file.path) ? 1 : 0),
		0
	);
	const progressPercent = files.length > 0 ? (viewedCount / files.length) * 100 : 0;

	return (
		<section className="border-t border-[var(--border)]">
			<div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3">
				<h2 className="text-[12px] font-medium text-[var(--text-secondary)]">Files</h2>
				<span className="shrink-0 text-[11px] tabular-nums text-[var(--text-quaternary)]">
					{viewedCount}/{files.length} viewed
				</span>
			</div>
			<div className="mx-3 h-[2px] overflow-hidden rounded-full bg-[var(--bg-elevated)]">
				<div
					className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
					style={{ width: `${progressPercent}%` }}
				/>
			</div>

			<div className="mt-2 pb-2">
				{files.length === 0 && (
					<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">No files</div>
				)}

				{files.map((file) => {
					const isViewed = viewedFiles.has(file.path);
					const isActive = activeFilePath === file.path;
					const commentCount = commentCountByFile.get(file.path) ?? 0;
					const { directory, filename } = splitPath(file.path);
					const viewedLabel = isViewed
						? `Mark ${file.path} as unviewed`
						: `Mark ${file.path} as viewed`;

					return (
						<div
							key={file.path}
							className={[
								"group flex min-h-7 items-center border-l-2 border-transparent text-[12px] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]",
								isActive ? "border-l-2 border-[var(--accent)] bg-[var(--bg-elevated)]" : "",
							].join(" ")}
						>
							<button
								type="button"
								aria-current={isActive ? "true" : undefined}
								title={file.path}
								onClick={() => onSelectFile(file.path)}
								className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 self-stretch py-1 pl-2 pr-1 text-left"
							>
								<span
									className={`size-1.5 shrink-0 rounded-full ${
										CHANGE_TYPE_DOT[file.changeType] ?? "bg-[var(--text-quaternary)]"
									}`}
								/>

								<span className="min-w-0 flex-1 truncate font-mono">
									{directory && <span className="text-[var(--text-quaternary)]">{directory}</span>}
									<span className="text-[var(--text-secondary)]">{filename}</span>
								</span>

								{commentCount > 0 && (
									<span className="shrink-0 rounded-full bg-[var(--bg-elevated)] px-1.5 text-[11px] font-medium leading-4 text-[var(--color-warning)]">
										{commentCount}
									</span>
								)}
							</button>

							<button
								type="button"
								aria-pressed={isViewed}
								aria-label={viewedLabel}
								title={viewedLabel}
								onClick={(event) => {
									event.stopPropagation();
									onToggleViewed(file.path, !isViewed);
								}}
								className={[
									"mr-2 flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition-colors duration-[120ms]",
									isViewed
										? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
										: "border-[var(--border)] text-[var(--text-quaternary)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
								].join(" ")}
							>
								{isViewed && (
									<svg
										width="12"
										height="12"
										viewBox="0 0 12 12"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										aria-hidden="true"
									>
										<path d="m2.5 6 2 2 5-5" />
									</svg>
								)}
							</button>
						</div>
					);
				})}
			</div>
		</section>
	);
}
