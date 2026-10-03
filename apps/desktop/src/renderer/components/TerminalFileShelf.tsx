import { useRef, useState } from "react";
import {
	FILE_COPY_WARNING_BYTES,
	type TerminalOwnedCopy,
	displayFilePath,
} from "../../shared/terminal-files";
import { trpcVanilla } from "../trpc/client";
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
	const [copyChoice, setCopyChoice] = useState<string | null>(null);
	const [owned, setOwned] = useState<TerminalOwnedCopy[] | null>(null);
	const [deleteChoice, setDeleteChoice] = useState<string | null>(null);
	const [copyError, setCopyError] = useState("");
	const [progress, setProgress] = useState<number | null>(null);
	const loadOwned = async () => {
		try {
			setOwned(await trpcVanilla.terminalFiles.listCopies.query({ terminalId }));
			setCopyError("");
		} catch {
			setCopyError("Copies unavailable. Reopen this workspace terminal to review them.");
		}
	};
	const copy = async (id: string) => {
		if (!controller || !state.batch) return;
		const batchId = state.batch.id;
		setCopyChoice(null);
		setProgress(0);
		const poll = setInterval(() => {
			void trpcVanilla.terminalFiles.progress
				.query({ batchId, id })
				.then(setProgress)
				.catch(() => {});
		}, 500);
		try {
			await controller.copy(id);
		} finally {
			clearInterval(poll);
			setProgress(null);
		}
	};
	return (
		<section
			aria-label={`Files for terminal ${terminalId}`}
			className="max-h-[45%] shrink-0 overflow-auto border-t border-[var(--border)] bg-[var(--bg-base)] p-2 text-xs text-[var(--text-secondary)]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<input
					ref={picker}
					type="file"
					multiple
					className="hidden"
					aria-label="Choose local files to link"
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
					Link files…
				</button>
				<button
					className={button}
					type="button"
					onClick={() => (owned ? setOwned(null) : void loadOwned())}
				>
					Workspace copies
				</button>
				{(state.batch || state.busy || state.status) && (
					<button className={button} type="button" onClick={() => controller?.clear()}>
						Clear / Cancel
					</button>
				)}
				<output aria-live="polite">
					{displayFilePath(state.status)}
					{progress !== null ? ` ${bytes(progress)} copied` : ""}
				</output>
			</div>
			{state.batch && (
				<>
					<p className="my-1">
						Local path references; provider understanding and access are unverified. Review the
						current shell/TUI input, including any unmatched quotes. Nothing is submitted
						automatically.
					</p>
					<p>
						Workspace: <bdi>{displayFilePath(state.batch.target.root)}</bdi>. Copy limits: 2
						GiB/file, 4 GiB/workspace. Copies persist until explicitly deleted and may be read by
						workspace tools immediately.
					</p>
					<ul className="my-1 space-y-1">
						{state.batch.entries.map((entry) => (
							<li key={entry.id} className="break-all rounded border border-[var(--border)] p-1">
								<bdi>{entry.label}</bdi> — {bytes(entry.size)}
								{entry.external
									? " · external; access unverified"
									: " · workspace; access unverified"}
								{entry.path && !entry.copyId && (
									<p>
										{entry.symlink ? "Canonical target" : "Reference path"}:{" "}
										<bdi>{displayFilePath(entry.path ?? "")}</bdi>
									</p>
								)}
								{entry.copyId && (
									<p>
										Retained copy: <bdi>{displayFilePath(entry.path ?? "")}</bdi>
									</p>
								)}
								{entry.error && <p>{entry.error}</p>}
								{!entry.referenceAllowed && entry.copyAllowed && (
									<p>
										Unsafe path for terminal input. Make a safe-name workspace copy or remove this
										entry.
									</p>
								)}
								<div className="flex flex-wrap gap-2">
									<button
										className={button}
										type="button"
										disabled={state.busy}
										aria-label={`Remove ${entry.label}`}
										onClick={() => controller?.remove(entry.id)}
									>
										Remove
									</button>
									{entry.copyAllowed && (
										<button
											className={button}
											type="button"
											disabled={state.busy}
											aria-label={`Copy ${entry.label} into workspace`}
											onClick={() => setCopyChoice(entry.id)}
										>
											Copy into workspace
										</button>
									)}
								</div>
								{copyChoice === entry.id && (
									<fieldset className="p-2" aria-label="Review workspace copy">
										<p>
											Copy {bytes(entry.size)} to a generated file under{" "}
											<bdi>
												{displayFilePath(state.batch?.target.root ?? "")}
												/.superiorswarm/attachments/
											</bdi>
											? The original stays in place. Copies are excluded from ordinary Git adds;
											backups, forced adds and agent tools can still see them.
										</p>
										{entry.size >= FILE_COPY_WARNING_BYTES && (
											<p>Large copy: allow time and sufficient disk space.</p>
										)}
										<button
											className={button}
											type="button"
											disabled={state.busy}
											onClick={() => void copy(entry.id)}
										>
											Confirm workspace copy
										</button>{" "}
										<button className={button} type="button" onClick={() => setCopyChoice(null)}>
											Keep original reference
										</button>
									</fieldset>
								)}
							</li>
						))}
					</ul>
					<button
						className={button}
						type="button"
						disabled={state.busy || state.batch.entries.some((entry) => !entry.referenceAllowed)}
						onClick={() => void controller?.insert()}
					>
						Insert paths ({state.batch.entries.length})
					</button>
				</>
			)}
			{copyError && <p role="alert">{copyError}</p>}
			{owned && (
				<div aria-label="Retained workspace copies">
					<p>
						Retained copies survive app restart. Deleting one can break old prompts. No saved copy
						is automatically inserted.
					</p>
					{owned.length === 0 && <p>No retained copies.</p>}
					<ul>
						{owned.map((item) => (
							<li key={item.id} className="my-1 break-all">
								<bdi>{item.label}</bdi> — {bytes(item.size)}
								{item.status === "incomplete" && (
									<p>
										Incomplete copy or uncertain cleanup. Retained for explicit review; never
										inserted automatically.
									</p>
								)}
								<br />
								<bdi>{displayFilePath(item.path)}</bdi>{" "}
								<button className={button} type="button" onClick={() => setDeleteChoice(item.id)}>
									Delete copied file…
								</button>
								{deleteChoice === item.id && (
									<>
										<button
											className={button}
											type="button"
											onClick={() => {
												void trpcVanilla.terminalFiles.deleteCopy
													.mutate({ terminalId, id: item.id })
													.then(() => {
														setDeleteChoice(null);
														return loadOwned();
													})
													.catch(() =>
														setCopyError(
															"Copy could not be deleted safely. Files have been retained."
														)
													);
											}}
										>
											Confirm deletion
										</button>{" "}
										<button className={button} type="button" onClick={() => setDeleteChoice(null)}>
											Keep copy
										</button>
									</>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
