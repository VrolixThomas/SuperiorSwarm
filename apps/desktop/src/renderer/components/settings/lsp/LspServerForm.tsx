import { useMemo, useState } from "react";
import { splitCsv } from "./config-form-bridge";
import { validateServerId } from "./validate-server-id";

export interface ServerFormData {
	id: string;
	command: string;
	args: string;
	fileExtensions: string;
	fileNames: string;
	languages: string;
	rootMarkers: string;
	initializationOptions: string;
}

interface LspServerFormProps {
	initial: ServerFormData;
	scope: "user" | "repo";
	repoPath: string | null;
	existingIds: Set<string>;
	builtInIds: Set<string>;
	onScopeChange: (scope: "user" | "repo") => void;
	onSave: (data: ServerFormData) => void;
	onCancel: () => void;
	saving: boolean;
	error: string | null;
	fieldErrors?: Record<string, string> | null;
	isEdit: boolean;
}

export function LspServerForm({
	initial,
	scope,
	repoPath,
	existingIds,
	builtInIds,
	onScopeChange,
	onSave,
	onCancel,
	saving,
	error,
	fieldErrors,
	isEdit,
}: LspServerFormProps) {
	const [form, setForm] = useState<ServerFormData>(initial);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [initOptsError, setInitOptsError] = useState<string | null>(null);

	const update = (field: keyof ServerFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
	};

	const idValidation = useMemo(() => {
		if (isEdit) return { error: null, warning: null };
		return validateServerId(form.id, { existingIds, builtInIds });
	}, [form.id, existingIds, builtInIds, isEdit]);
	const idError = idValidation.error;
	const idWarning = idValidation.warning;
	const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);

	const validateInitOpts = (raw: string): string | null => {
		const trimmed = raw.trim();
		if (!trimmed) return null;
		try {
			const parsed = JSON.parse(trimmed);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				return "Initialization Options must be a JSON object";
			}
			return null;
		} catch (e) {
			return e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON";
		}
	};

	const saveDisabled =
		saving ||
		!form.command.trim() ||
		(!isEdit && idError !== null) ||
		initOptsError !== null ||
		(!isEdit && idWarning !== null && !overrideAcknowledged);

	const hasNoMatchers =
		splitCsv(form.fileExtensions).length === 0 &&
		splitCsv(form.fileNames).length === 0 &&
		splitCsv(form.languages).length === 0;

	const commandHasSpaces =
		form.command.trim().includes(" ") && !form.command.trim().startsWith("/");

	return (
		<div>
			<div className="mb-4">
				<div className="text-[15px] font-semibold text-[var(--text)]">
					{isEdit ? `Edit: ${form.id}` : form.id || "New Server"}
				</div>
				<div className="text-[11px] text-[var(--text-tertiary)]">
					{isEdit ? "Update server configuration" : "Pre-filled from preset — edit if needed"}
				</div>
			</div>

			{/* Scope picker */}
			<div className="mb-4">
				<div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
					Save to
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => onScopeChange("user")}
						className={`flex-1 rounded-[6px] border px-3 py-2 text-center transition-colors ${
							scope === "user"
								? "border-[#6666ff] bg-[rgba(100,100,255,0.1)]"
								: "border-[var(--border)]"
						}`}
					>
						<div
							className={`text-[12px] font-medium ${scope === "user" ? "text-[#8888ff]" : "text-[var(--text-tertiary)]"}`}
						>
							Global
						</div>
						<div className="text-[9px] text-[var(--text-quaternary)]">All projects</div>
					</button>
					<button
						type="button"
						disabled={!repoPath}
						onClick={() => onScopeChange("repo")}
						className={`flex-1 rounded-[6px] border px-3 py-2 text-center transition-colors disabled:opacity-40 ${
							scope === "repo"
								? "border-[#ff9f0a] bg-[rgba(255,159,10,0.1)]"
								: "border-[var(--border)]"
						}`}
						title={!repoPath ? "Open a project to save repo-specific config" : undefined}
					>
						<div
							className={`text-[12px] font-medium ${scope === "repo" ? "text-[var(--color-warning)]" : "text-[var(--text-tertiary)]"}`}
						>
							This Repo
						</div>
						<div className="truncate text-[9px] text-[var(--text-quaternary)]">
							{repoPath ?? "No active workspace"}
						</div>
					</button>
				</div>
			</div>

			{/* ID — editable only when adding */}
			{isEdit ? (
				<div className="mb-3">
					<div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
						ID
					</div>
					<div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text-tertiary)]">
						{form.id}
					</div>
					<div className="mt-1 text-[10px] text-[var(--text-quaternary)]">
						ID cannot be changed. Remove and re-add to rename.
					</div>
				</div>
			) : (
				<>
					<FormField
						label="ID"
						value={form.id}
						onChange={(v) => {
							update("id", v);
							setOverrideAcknowledged(false);
						}}
						mono
						error={form.id ? idError : null}
						placeholder="e.g. my-lang"
					/>
					{idWarning && !idError && (
						<div className="mb-3 rounded-[6px] bg-[rgba(255,214,10,0.08)] px-3 py-2 text-[11px] text-[#ffd60a]">
							<div className="mb-1">{idWarning}</div>
							<label className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
								<input
									type="checkbox"
									checked={overrideAcknowledged}
									onChange={(e) => setOverrideAcknowledged(e.target.checked)}
								/>
								I understand — override the built-in
							</label>
						</div>
					)}
				</>
			)}

			{/* Basic fields */}
			<CommandField
				value={form.command}
				onChange={(v) => update("command", v)}
				onBrowse={async () => {
					const picked = await window.electron.dialog.openFile({
						filters: [{ name: "Executables", extensions: ["*"] }],
					});
					if (picked) update("command", picked);
				}}
				error={fieldErrors?.command ?? null}
			/>
			<FormField
				label="Arguments"
				value={form.args}
				onChange={(v) => update("args", v)}
				mono
				error={fieldErrors?.args ?? null}
			/>
			<FormField
				label="File Extensions"
				value={form.fileExtensions}
				onChange={(v) => update("fileExtensions", v)}
				mono
				error={fieldErrors?.fileExtensions ?? null}
			/>

			{/* Advanced */}
			<details
				open={showAdvanced}
				onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
				className="mb-4"
			>
				<summary className="cursor-pointer text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
					Advanced options
				</summary>
				<div className="mt-2 space-y-3">
					<FormField
						label="File Names (exact match, e.g. Dockerfile, Makefile)"
						value={form.fileNames}
						onChange={(v) => update("fileNames", v)}
						mono
					/>
					<FormField
						label="Language IDs"
						value={form.languages}
						onChange={(v) => update("languages", v)}
						mono
					/>
					<FormField
						label="Root Markers"
						value={form.rootMarkers}
						onChange={(v) => update("rootMarkers", v)}
						mono
					/>
					<div>
						<div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
							Initialization Options (JSON)
						</div>
						<textarea
							value={form.initializationOptions}
							onChange={(e) => {
								update("initializationOptions", e.target.value);
								setInitOptsError(validateInitOpts(e.target.value));
							}}
							onBlur={(e) => setInitOptsError(validateInitOpts(e.target.value))}
							className={`h-[50px] w-full resize-y rounded-[6px] border bg-[var(--bg-elevated)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)] focus:outline-none ${
								initOptsError ? "border-[#ff453a]" : "border-[var(--border)]"
							}`}
						/>
						{initOptsError && (
							<div className="mt-1 text-[10px] text-[var(--color-danger)]">{initOptsError}</div>
						)}
					</div>
				</div>
			</details>

			{/* Warnings */}
			{(hasNoMatchers || commandHasSpaces) && (
				<div className="mb-3 space-y-1 rounded-[6px] bg-[rgba(255,214,10,0.08)] px-3 py-2 text-[11px] text-[#ffd60a]">
					{hasNoMatchers && (
						<div>
							No file extensions, file names, or language IDs set — this server won't match any
							file. Add at least one under File Extensions / Advanced → File Names or Language IDs.
						</div>
					)}
					{commandHasSpaces && (
						<div>
							Command looks like it contains arguments. Put the binary name in Command and arguments
							in Arguments.
						</div>
					)}
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="mb-3 rounded-[6px] bg-[rgba(255,69,58,0.1)] px-3 py-2 text-[11px] text-[var(--color-danger)]">
					{error}
				</div>
			)}

			{/* Buttons */}
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-1.5 text-[12px] text-[var(--text-tertiary)]"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={saveDisabled}
					onClick={() => onSave(form)}
					className="rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[12px] text-[var(--accent-foreground)] disabled:opacity-50"
				>
					{saving ? "Saving..." : isEdit ? "Save Changes" : "Add Server"}
				</button>
			</div>
		</div>
	);
}

function CommandField({
	value,
	onChange,
	onBrowse,
	error,
}: {
	value: string;
	onChange: (value: string) => void;
	onBrowse: () => void;
	error?: string | null;
}) {
	return (
		<div className="mb-3">
			<div className="mb-1 flex items-center justify-between">
				<span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
					Command or absolute path
				</span>
				<button
					type="button"
					onClick={onBrowse}
					className="rounded-[4px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
				>
					Browse…
				</button>
			</div>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="e.g. gopls or /opt/homebrew/bin/gopls"
				className={`w-full rounded-[6px] border bg-[var(--bg-elevated)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--text)] focus:outline-none ${
					error ? "border-[#ff453a]" : "border-[var(--border)]"
				}`}
			/>
			{error && <div className="mt-1 text-[10px] text-[var(--color-danger)]">{error}</div>}
			<div className="mt-1 text-[10px] text-[var(--text-quaternary)]">
				Bare name is looked up on PATH. Absolute path skips PATH lookup — useful for nix / asdf /
				mise / manual installs.
			</div>
		</div>
	);
}

function FormField({
	label,
	value,
	onChange,
	mono,
	error,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	mono?: boolean;
	error?: string | null;
	placeholder?: string;
}) {
	return (
		<div className="mb-3">
			<div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
				{label}
			</div>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className={`w-full rounded-[6px] border bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--text)] focus:outline-none ${
					error ? "border-[#ff453a]" : "border-[var(--border)]"
				} ${mono ? "font-mono" : ""}`}
			/>
			{error && <div className="mt-1 text-[10px] text-[var(--color-danger)]">{error}</div>}
		</div>
	);
}
