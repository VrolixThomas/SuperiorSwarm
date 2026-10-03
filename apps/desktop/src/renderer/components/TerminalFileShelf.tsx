import { useRef, useState } from "react";
import { displayFilePath } from "../../shared/terminal-files";
import type { FileShelfState, TerminalFileController } from "./terminal-file-controller";
const button =
	"rounded border border-[var(--border)] px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const bytes = (n: number) =>
	n >= 1024 ** 3
		? `${(n / 1024 ** 3).toFixed(1)} GiB`
		: n >= 1024 ** 2
			? `${(n / 1024 ** 2).toFixed(1)} MiB`
			: `${n.toLocaleString()} bytes`;
export function TerminalFileShelf({
	terminalId,
	controller,
	state,
	onFiles,
}: {
	terminalId: string;
	controller: TerminalFileController | null;
	state: FileShelfState;
	onFiles: (files: File[]) => void;
}) {
	const picker = useRef<HTMLInputElement>(null);
	const [detailsId, setDetailsId] = useState<string | null>(null);
	const selected = state.batch?.entries.find((entry) => entry.id === detailsId);
	const count = state.batch?.entries.length ?? 0;
	return (
		<section
			aria-label={`Files for terminal ${terminalId}`}
			className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-xs text-[var(--text-secondary)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<input
					ref={picker}
					type="file"
					multiple
					className="hidden"
					aria-label="Choose local files to add"
					onChange={(event) => {
						onFiles(Array.from(event.currentTarget.files ?? []));
						event.currentTarget.value = "";
					}}
				/>
				<button
					className={button}
					type="button"
					disabled={!controller || state.busy}
					onClick={() => picker.current?.click()}
				>
					Add files…
				</button>
				{count > 0 && (
					<>
						<span className="font-medium text-[var(--text)]">
							{count} {count === 1 ? "file" : "files"} added
						</span>
						<span className="text-[var(--text-tertiary)]">
							{state.batch?.inputAvailability === "update-required"
								? "Terminal update required"
								: state.batch?.inputAvailability === "unverified"
									? "Prompt access unverified"
									: "Enter to send"}
						</span>
					</>
				)}
				<div className="ml-auto flex items-center gap-2">
					{count > 0 && (
						<button
							className={button}
							type="button"
							disabled={!controller || state.busy}
							title="Copy validated paths to paste into your prompt manually"
							onClick={() => void controller?.copyPaths()}
						>
							Copy paths
						</button>
					)}
					{(state.batch || state.busy) && (
						<button
							className={button}
							type="button"
							onClick={() => {
								controller?.clear();
								controller?.focusInput();
							}}
						>
							{state.busy ? "Cancel" : "Clear files"}
						</button>
					)}
				</div>
			</div>
			{count > 0 && (
				<ul
					aria-label="Files in this message"
					className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto"
				>
					{state.batch?.entries.map((entry) => (
						<li
							key={entry.id}
							className="flex max-w-full items-center rounded-md border border-[var(--border)] bg-[var(--bg-surface)]"
						>
							<button
								type="button"
								className="flex min-w-0 items-center gap-2 rounded-l-md px-2 py-1.5 hover:bg-[var(--bg-elevated)] focus-visible:outline-2"
								aria-label={`Details for ${entry.label}`}
								aria-expanded={selected?.id === entry.id}
								title={displayFilePath(entry.path ?? entry.label)}
								onClick={() => {
									setDetailsId(selected?.id === entry.id ? null : entry.id);
								}}
							>
								<span className="max-w-48 truncate">
									<bdi>{entry.label}</bdi>
								</span>
								{!entry.referenceAllowed && (
									<span className="text-[var(--text)]">Needs attention</span>
								)}
							</button>
							<button
								type="button"
								className="self-stretch rounded-r-md px-2 hover:bg-[var(--bg-elevated)] focus-visible:outline-2 disabled:opacity-50"
								disabled={state.busy}
								aria-label={`Remove ${entry.label}`}
								onClick={() => {
									controller?.remove(entry.id);
									controller?.focusInput();
								}}
							>
								<span aria-hidden="true">×</span>
							</button>
						</li>
					))}
				</ul>
			)}
			<output aria-live="polite" className="mt-1 block empty:hidden text-[var(--text-tertiary)]">
				{displayFilePath(state.status)}
			</output>
			{selected && (
				<div
					className="mt-2 max-h-48 space-y-2 overflow-y-auto break-all rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-2"
					aria-label={`File details for ${selected.label}`}
				>
					<div className="flex items-center justify-between gap-2">
						<bdi className="font-medium">{selected.label}</bdi>
						<span>
							{bytes(selected.size)} · {selected.external ? "External file" : "Workspace file"}
						</span>
					</div>
					{selected.path && (
						<p>
							{selected.symlink ? "Canonical target" : "Path"}:{" "}
							<bdi>{displayFilePath(selected.path)}</bdi>
						</p>
					)}
					<p>
						Sent as a local path. Reading the file depends on the CLI’s tools and permissions.
						Review shell quotes or unusual prompts before sending.
					</p>
					{selected.error && <p role="alert">{selected.error}</p>}
					{!selected.referenceAllowed && selected.kind !== "unsupported" && (
						<p>
							This path contains unsupported characters. Rename the file or its folders, then add it
							again.
						</p>
					)}
				</div>
			)}
		</section>
	);
}
