import { useState } from "react";
import { trpc } from "../../trpc/client";
import { SectionLabel } from "./SectionHeading";

// External managers: outside agent runtimes (e.g. Hermes) that coordinate
// SuperiorSwarm workspaces over the MCP server using a per-manager token.

function policyLabel(policy: string): string {
	return policy === "auto" ? "Auto-dispatch" : "Confirm dispatch";
}

function TokenReveal({
	token,
	onInstallHermes,
	hermesDetected,
	hermesConfigPath,
	installedPath,
	installPending,
	installError,
	snippetTemplate,
	tokenPlaceholder,
}: {
	token: string;
	onInstallHermes: () => void;
	hermesDetected: boolean;
	hermesConfigPath: string;
	installedPath: string | null;
	installPending: boolean;
	installError: string | null;
	snippetTemplate: string;
	tokenPlaceholder: string;
}) {
	const [copied, setCopied] = useState<string | null>(null);
	const copy = (text: string, key: string) => {
		navigator.clipboard.writeText(text);
		setCopied(key);
		setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
	};

	// Rendered in the main process from the same entry builder the install
	// button uses, so this snippet cannot drift from what gets written.
	const snippet = snippetTemplate.replace(tokenPlaceholder, token);

	return (
		<div className="flex flex-col gap-2.5 border-t border-[var(--border-subtle)] px-4 py-3.5">
			<span className="text-[11px] text-[var(--text-tertiary)]">
				Copy this token now, it is shown only once. SuperiorSwarm stores only a hash.
			</span>
			<div className="flex items-center gap-2">
				<code className="min-w-0 flex-1 truncate rounded-[6px] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
					{token}
				</code>
				<button
					type="button"
					onClick={() => copy(token, "token")}
					className="shrink-0 rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					{copied === "token" ? "Copied" : "Copy"}
				</button>
			</div>
			<div className="flex items-center justify-between">
				<span className="text-[11px] text-[var(--text-tertiary)]">
					Hermes config snippet (~/.hermes/config.yaml)
				</span>
				<button
					type="button"
					onClick={() => copy(snippet, "snippet")}
					className="shrink-0 rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					{copied === "snippet" ? "Copied" : "Copy"}
				</button>
			</div>
			<pre className="overflow-x-auto rounded-[6px] bg-[var(--bg-base)] p-3 text-[11px] text-[var(--text-secondary)]">
				{snippet}
			</pre>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onInstallHermes}
					disabled={installPending}
					className="shrink-0 rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
				>
					{installPending ? "..." : "Install into Hermes"}
				</button>
				<span
					className={`truncate text-[11px] ${installError ? "text-[var(--color-danger)]" : "text-[var(--text-tertiary)]"}`}
				>
					{installError
						? `Install failed: ${installError}`
						: installedPath
							? `Written to ${installedPath}`
							: hermesDetected
								? hermesConfigPath
								: "Hermes not detected on PATH, writes the config anyway"}
				</span>
			</div>
		</div>
	);
}

export function ExternalManagersSettings() {
	const utils = trpc.useUtils();

	const { data: managers } = trpc.externalManagers.list.useQuery(undefined, { staleTime: 5_000 });
	const { data: installInfo } = trpc.externalManagers.installInfo.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: projects } = trpc.projects.list.useQuery(undefined, { staleTime: 30_000 });

	const [name, setName] = useState("");
	const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
	const [autoDispatch, setAutoDispatch] = useState(false);
	// One-time raw token, keyed by manager id (from create or regenerate).
	const [revealedToken, setRevealedToken] = useState<{ id: string; token: string } | null>(null);
	const [installedPath, setInstalledPath] = useState<string | null>(null);

	const create = trpc.externalManagers.create.useMutation({
		onSuccess: (res) => {
			utils.externalManagers.list.invalidate();
			setRevealedToken({ id: res.id, token: res.token });
			setInstalledPath(null);
			setName("");
			setSelectedProjects([]);
			setAutoDispatch(false);
		},
	});
	const regenerate = trpc.externalManagers.regenerateToken.useMutation({
		onSuccess: (res, vars) => {
			setRevealedToken({ id: vars.id, token: res.token });
			setInstalledPath(null);
		},
	});
	const setPolicy = trpc.externalManagers.setDispatchPolicy.useMutation({
		onSuccess: () => utils.externalManagers.list.invalidate(),
	});
	const remove = trpc.externalManagers.delete.useMutation({
		onSuccess: (_res, vars) => {
			utils.externalManagers.list.invalidate();
			setRevealedToken((t) => (t?.id === vars.id ? null : t));
		},
	});
	const installHermes = trpc.externalManagers.installIntoHermes.useMutation({
		onSuccess: (res) => setInstalledPath(res.configPath),
	});

	const toggleProject = (id: string) => {
		setSelectedProjects((prev) =>
			prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
		);
	};

	const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? id;
	const canCreate = name.trim().length > 0 && selectedProjects.length > 0 && !create.isPending;

	return (
		<>
			<SectionLabel>External managers</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
				{managers?.length ? (
					managers.map((m) => (
						<div key={m.id}>
							<div className="flex items-center gap-3 px-4 py-3.5">
								<div className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="text-[13px] font-medium text-[var(--text)]">{m.name}</span>
									<span className="truncate text-[11px] text-[var(--text-tertiary)]">
										{policyLabel(m.dispatchPolicy)} ·{" "}
										{m.linkedProjectIds.map(projectName).join(", ") || "no projects"} ·{" "}
										{m.lastSeenAt
											? `last seen ${new Date(m.lastSeenAt).toLocaleString()}`
											: "never connected"}
									</span>
								</div>
								<button
									type="button"
									onClick={() =>
										setPolicy.mutate({
											id: m.id,
											dispatchPolicy: m.dispatchPolicy === "auto" ? "confirm" : "auto",
										})
									}
									disabled={setPolicy.isPending}
									title={
										m.dispatchPolicy === "auto"
											? "Dispatches run without an approval modal. Dispatched agents skip permission prompts."
											: "Every dispatch requires approval in the app."
									}
									className="shrink-0 rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] disabled:opacity-50"
								>
									{policyLabel(m.dispatchPolicy)}
								</button>
								<button
									type="button"
									onClick={() => regenerate.mutate({ id: m.id })}
									disabled={regenerate.isPending}
									className="shrink-0 rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] disabled:opacity-50"
								>
									New token
								</button>
								<button
									type="button"
									onClick={() => remove.mutate({ id: m.id })}
									disabled={remove.isPending}
									className="shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[rgba(255,59,48,0.1)] hover:text-[var(--color-danger)] disabled:opacity-50"
								>
									Delete
								</button>
							</div>
							{revealedToken?.id === m.id && installInfo && (
								<TokenReveal
									token={revealedToken.token}
									onInstallHermes={() =>
										installHermes.mutate({ managerToken: revealedToken.token })
									}
									hermesDetected={installInfo.hermesDetected}
									hermesConfigPath={installInfo.hermesConfigPath}
									installedPath={installedPath}
									installPending={installHermes.isPending}
									installError={installHermes.error?.message ?? null}
									snippetTemplate={installInfo.hermesSnippetTemplate}
									tokenPlaceholder={installInfo.managerTokenPlaceholder}
								/>
							)}
						</div>
					))
				) : (
					<div className="px-4 py-3.5 text-[11px] text-[var(--text-tertiary)]">
						No external managers yet. Create one to let an outside agent (e.g. Hermes) dispatch and
						coordinate workspaces here.
					</div>
				)}
				<div className="flex flex-col gap-2.5 px-4 py-3.5">
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Manager name (e.g. Hermes)"
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
					/>
					<div className="flex flex-wrap items-center gap-1.5">
						{projects?.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => toggleProject(p.id)}
								className={`rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
									selectedProjects.includes(p.id)
										? "bg-[var(--accent-subtle)] text-[var(--accent)]"
										: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
								}`}
							>
								{p.name}
							</button>
						))}
					</div>
					<div className="flex items-center gap-2">
						<label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
							<input
								type="checkbox"
								checked={autoDispatch}
								onChange={(e) => setAutoDispatch(e.target.checked)}
							/>
							Auto-approve dispatches (agents run with permission prompts skipped)
						</label>
						<button
							type="button"
							onClick={() =>
								create.mutate({
									name: name.trim(),
									projectIds: selectedProjects,
									dispatchPolicy: autoDispatch ? "auto" : "confirm",
								})
							}
							disabled={!canCreate}
							className="ml-auto shrink-0 rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							{create.isPending ? "..." : "Create"}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}
