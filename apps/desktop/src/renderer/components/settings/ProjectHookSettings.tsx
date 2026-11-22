import { useState } from "react";
import type { QueueHookProjectStatus } from "../../../shared/queue-hooks";
import { trpc } from "../../trpc/client";
import { SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

export function ProjectHookSettings() {
	const status = trpc.queueHooks.status.useQuery(undefined, { refetchInterval: 15_000 });
	const [reviewing, setReviewing] = useState<QueueHookProjectStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const utils = trpc.useUtils();
	const refresh = () => utils.queueHooks.status.invalidate();
	const callbacks = {
		onSuccess: refresh,
		onError: () =>
			setError("The hook settings changed or the request failed. Refresh and try again."),
	};
	const enable = trpc.queueHooks.setEnabled.useMutation(callbacks);
	const trust = trpc.queueHooks.trust.useMutation(callbacks);
	const revoke = trpc.queueHooks.revoke.useMutation(callbacks);
	const run = trpc.queueHooks.run.useMutation(callbacks);
	const busy = enable.isPending || trust.isPending || revoke.isPending || run.isPending;
	return (
		<section>
			<SectionLabel>Project queue checks</SectionLabel>
			<div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<ToggleRow
					label="Enable project queue checks"
					description="Run explicitly trusted checks from each project's .superiorswarm/queue.yml. Checks can execute commands on your computer."
					checked={status.data?.enabled ?? false}
					disabled={busy || !status.data}
					onChange={() => enable.mutate(!status.data?.enabled)}
				/>
				{error && (
					<p role="alert" className="px-4 py-2 text-[var(--text-secondary)]">
						{error}
					</p>
				)}
				{status.data?.enabled && (
					<div className="space-y-3 px-4 pb-4">
						<p className="text-xs text-[var(--text-secondary)]">
							Add hooks with id, title, run and every (for example 5m). Each command prints JSON
							lines with key, title and why; url, severity and fixPrompt are optional. Checks run at
							the project root, once per project across its workspaces and orchestrators.
						</p>
						{status.data.projects
							.filter((project) => project.hash || project.error)
							.map((project) => (
								<div key={project.projectId} className="rounded border border-[var(--border)] p-3">
									<p className="text-sm font-medium">{project.projectName}</p>
									<p className="break-all text-xs text-[var(--text-secondary)]">{project.root}</p>
									{project.error && <output>{project.error}</output>}
									{project.hash && (
										<>
											<p className="my-2 text-xs">
												{project.trusted
													? "Trusted configuration"
													: "Review required before execution"}{" "}
												· {project.hooks.length} checks
											</p>
											{reviewing?.projectId === project.projectId && (
												<div className="my-2">
													<p className="text-xs">
														Review all commands below. Trust applies only to these exact
														configuration bytes and this project root: {reviewing.root}.
													</p>
													<pre className="my-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--bg-elevated)] p-2 text-xs">
														{reviewing.configText}
													</pre>
													<button
														type="button"
														disabled={busy}
														onClick={() => {
															setError(null);
															if (reviewing.hash)
																trust.mutate({
																	projectId: reviewing.projectId,
																	hash: reviewing.hash,
																});
															setReviewing(null);
														}}
														className="rounded border border-[var(--border)] px-3 py-1 text-xs"
													>
														Trust these hooks
													</button>
												</div>
											)}
											<div className="flex gap-3 text-xs">
												<button
													type="button"
													disabled={busy}
													onClick={() =>
														setReviewing(
															reviewing?.projectId === project.projectId ? null : { ...project }
														)
													}
												>
													Review configuration
												</button>
												{project.trusted && (
													<>
														<button
															type="button"
															disabled={busy}
															onClick={() => {
																setError(null);
																run.mutate({ projectId: project.projectId });
															}}
														>
															{run.isPending ? "Checking…" : "Run checks now"}
														</button>
														<button
															type="button"
															disabled={busy}
															onClick={() => revoke.mutate({ projectId: project.projectId })}
														>
															Revoke trust
														</button>
													</>
												)}
											</div>
										</>
									)}
								</div>
							))}
					</div>
				)}
			</div>
		</section>
	);
}
