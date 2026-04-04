import type { ConflictFile } from "../../shared/branch-types";

interface Props {
	files: ConflictFile[];
	activeFile: string | null;
	onSelectFile: (path: string) => void;
}

export function ConflictFileSidebar({ files, activeFile, onSelectFile }: Props) {
	const conflicting = files.filter((f) => f.status === "conflicting");
	const resolved = files.filter((f) => f.status === "resolved");

	return (
		<div className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[rgba(0,0,0,0.2)]">
			<div className="flex-1 overflow-y-auto p-2">
				{conflicting.length > 0 && (
					<div className="mb-2">
						<div className="px-2 py-1 text-[11px] uppercase tracking-wider text-[var(--text-quaternary)]">
							Conflicting
						</div>
						{conflicting.map((file) => (
							<button
								key={file.path}
								type="button"
								onClick={() => onSelectFile(file.path)}
								className={[
									"flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] transition-all duration-[var(--transition-fast)]",
									activeFile === file.path
										? "border border-[rgba(10,132,255,0.15)] bg-[rgba(10,132,255,0.1)] text-[var(--text)]"
										: "text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)]",
								].join(" ")}
							>
								<svg
									aria-hidden="true"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="#ff9f0a"
									strokeWidth="2"
									className="shrink-0"
								>
									<circle cx="12" cy="12" r="10" />
									<path d="M12 8v4" />
									<path d="M12 16h.01" />
								</svg>
								<span className="min-w-0 truncate">{file.path.split("/").pop()}</span>
							</button>
						))}
					</div>
				)}
				{resolved.length > 0 && (
					<div>
						<div className="px-2 py-1 text-[11px] uppercase tracking-wider text-[var(--text-quaternary)]">
							Resolved
						</div>
						{resolved.map((file) => (
							<button
								key={file.path}
								type="button"
								onClick={() => onSelectFile(file.path)}
								className={[
									"flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] opacity-60 transition-all duration-[var(--transition-fast)]",
									activeFile === file.path
										? "bg-[rgba(10,132,255,0.1)] text-[var(--text)]"
										: "text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.04)]",
								].join(" ")}
							>
								<svg
									aria-hidden="true"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="#30d158"
									strokeWidth="2"
									className="shrink-0"
								>
									<circle cx="12" cy="12" r="10" />
									<path d="m9 12 2 2 4-4" />
								</svg>
								<span className="min-w-0 truncate line-through">{file.path.split("/").pop()}</span>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
