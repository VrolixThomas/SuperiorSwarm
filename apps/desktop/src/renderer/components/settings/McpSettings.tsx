import { useState } from "react";
import type { CliPresetName } from "../../../shared/cli-preset";
import type { McpFormat } from "../../../shared/mcp-format";
import { trpc } from "../../trpc/client";
import { PageHeading, SectionLabel } from "./SectionHeading";

const CLI_LABELS: Record<CliPresetName, string> = {
	claude: "Claude Code",
	gemini: "Gemini CLI",
	codex: "Codex",
	opencode: "OpenCode",
};

const FORMAT_LABELS: Record<McpFormat, string> = {
	json: "JSON",
	toml: "TOML",
	opencode: "OpenCode",
};

function McpCliRow({
	name,
	detected,
	installed,
	configPath,
	isPending,
	onInstall,
	onUninstall,
}: {
	name: string;
	detected: boolean;
	installed: boolean;
	configPath: string;
	isPending: boolean;
	onInstall: () => void;
	onUninstall: () => void;
}) {
	let subtitle: string;
	if (!detected) subtitle = "Not detected on PATH";
	else if (!installed) subtitle = "Detected, not installed";
	else subtitle = configPath;

	return (
		<div className="flex items-center gap-3 px-4 py-3.5">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-[13px] font-medium text-[var(--text)]">{name}</span>
				<div className="flex items-center gap-1.5">
					<div
						className={`size-1.5 shrink-0 rounded-full ${
							installed
								? "bg-[#32d74b]"
								: detected
									? "bg-[var(--text-tertiary)]"
									: "bg-[var(--text-quaternary)]"
						}`}
					/>
					<span className="truncate text-[11px] text-[var(--text-tertiary)]">{subtitle}</span>
				</div>
			</div>
			{installed ? (
				<button
					type="button"
					onClick={onUninstall}
					disabled={isPending}
					className="shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[rgba(255,59,48,0.1)] hover:text-[var(--color-danger)] disabled:opacity-50"
				>
					Uninstall
				</button>
			) : (
				<button
					type="button"
					onClick={onInstall}
					disabled={!detected || isPending}
					className="shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] disabled:opacity-50"
				>
					Install
				</button>
			)}
		</div>
	);
}

export function McpSettings() {
	const utils = trpc.useUtils();

	const { data: mcpData } = trpc.globalMcp.listInstalls.useQuery(undefined, { staleTime: 5_000 });
	const installMcp = trpc.globalMcp.installFor.useMutation({
		onSuccess: () => utils.globalMcp.listInstalls.invalidate(),
	});
	const uninstallMcp = trpc.globalMcp.uninstallFor.useMutation({
		onSuccess: () => utils.globalMcp.listInstalls.invalidate(),
	});

	const { data: customData } = trpc.globalMcp.listCustom.useQuery(undefined, { staleTime: 5_000 });
	const removeCustom = trpc.globalMcp.removeCustom.useMutation({
		onSuccess: () => utils.globalMcp.listCustom.invalidate(),
	});
	const [label, setLabel] = useState("");
	const [configPath, setConfigPath] = useState("");
	const [format, setFormat] = useState<McpFormat>("json");
	const [addError, setAddError] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);

	const addCustom = trpc.globalMcp.addCustom.useMutation({
		onSuccess: () => {
			utils.globalMcp.listCustom.invalidate();
			setLabel("");
			setConfigPath("");
			setFormat("json");
			setAddError(null);
		},
		onError: (err) => setAddError(err.message),
	});

	const launcher = mcpData?.launcherPath ?? "";
	const snippet = JSON.stringify(
		{ mcpServers: { superiorswarm: { command: launcher, args: [] } } },
		null,
		2
	);

	const browse = async () => {
		const picked = await window.electron.dialog.openFile({
			filters: [
				{ name: "Config", extensions: ["json", "toml"] },
				{ name: "All Files", extensions: ["*"] },
			],
		});
		if (picked) {
			setConfigPath(picked);
			setFormat(picked.endsWith(".toml") ? "toml" : "json");
			setAddError(null);
		}
	};

	const copy = (text: string, key: string) => {
		navigator.clipboard.writeText(text);
		setCopied(key);
		setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
	};

	const canAdd = label.trim().length > 0 && configPath.trim().length > 0 && !addCustom.isPending;

	return (
		<div>
			<PageHeading title="MCP" subtitle="Connect SuperiorSwarm's tools to your coding agent" />

			<SectionLabel>Quick install</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
				{mcpData?.items.map((item) => (
					<McpCliRow
						key={item.cliPreset}
						name={CLI_LABELS[item.cliPreset as CliPresetName] ?? item.cliPreset}
						detected={item.detected}
						installed={item.installed}
						configPath={item.configPath}
						isPending={installMcp.isPending || uninstallMcp.isPending}
						onInstall={() => installMcp.mutate({ cliPreset: item.cliPreset as CliPresetName })}
						onUninstall={() => uninstallMcp.mutate({ cliPreset: item.cliPreset as CliPresetName })}
					/>
				))}
			</div>

			<SectionLabel>Custom agents</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
				{customData?.length ? (
					customData.map((row) => (
						<div key={row.id} className="flex items-center gap-3 px-4 py-3.5">
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="text-[13px] font-medium text-[var(--text)]">{row.label}</span>
								<span className="truncate text-[11px] text-[var(--text-tertiary)]">
									{row.configPath} · {FORMAT_LABELS[row.format as McpFormat] ?? row.format}
								</span>
							</div>
							<button
								type="button"
								onClick={() => removeCustom.mutate({ id: row.id })}
								disabled={removeCustom.isPending}
								className="shrink-0 rounded-[5px] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[rgba(255,59,48,0.1)] hover:text-[var(--color-danger)] disabled:opacity-50"
							>
								Uninstall
							</button>
						</div>
					))
				) : (
					<div className="px-4 py-3.5 text-[11px] text-[var(--text-tertiary)]">
						No custom agents yet.
					</div>
				)}
				<div className="flex flex-col gap-2.5 px-4 py-3.5">
					<input
						type="text"
						value={label}
						onChange={(e) => {
							setLabel(e.target.value);
							setAddError(null);
						}}
						placeholder="Agent name (e.g. Cursor)"
						className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
					/>
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={configPath}
							readOnly
							placeholder="Config file path"
							className="min-w-0 flex-1 truncate rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)]"
						/>
						<button
							type="button"
							onClick={browse}
							className="shrink-0 rounded-[5px] border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
						>
							Browse
						</button>
					</div>
					<div className="flex items-center gap-1.5">
						{(["json", "toml", "opencode"] as McpFormat[]).map((f) => (
							<button
								key={f}
								type="button"
								onClick={() => setFormat(f)}
								className={`rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
									format === f
										? "bg-[var(--accent-subtle)] text-[var(--accent)]"
										: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
								}`}
							>
								{FORMAT_LABELS[f]}
							</button>
						))}
						<button
							type="button"
							onClick={() =>
								addCustom.mutate({
									label: label.trim(),
									configPath: configPath.trim(),
									format,
								})
							}
							disabled={!canAdd}
							className="ml-auto shrink-0 rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
						>
							{addCustom.isPending ? "..." : "Install here"}
						</button>
					</div>
					{addError && <span className="text-[11px] text-[var(--color-danger)]">{addError}</span>}
				</div>
			</div>

			<SectionLabel>Manual setup</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<div className="flex items-center gap-3 px-4 py-3.5">
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">Launcher command</span>
						<span className="truncate text-[11px] text-[var(--text-tertiary)]">{launcher}</span>
					</div>
					<button
						type="button"
						onClick={() => copy(launcher, "launcher")}
						className="shrink-0 rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					>
						{copied === "launcher" ? "Copied" : "Copy"}
					</button>
				</div>
				<div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] px-4 py-3.5">
					<div className="flex items-center justify-between">
						<span className="text-[13px] font-medium text-[var(--text)]">Config snippet</span>
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
				</div>
			</div>
		</div>
	);
}
