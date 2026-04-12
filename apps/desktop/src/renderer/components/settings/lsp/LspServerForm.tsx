import { useState } from "react";

export interface ServerFormData {
	id: string;
	command: string;
	args: string;
	fileExtensions: string;
	languages: string;
	rootMarkers: string;
	initializationOptions: string;
}

interface LspServerFormProps {
	initial: ServerFormData;
	scope: "user" | "repo";
	repoPath: string | null;
	onScopeChange: (scope: "user" | "repo") => void;
	onSave: (data: ServerFormData) => void;
	onCancel: () => void;
	saving: boolean;
	error: string | null;
	isEdit: boolean;
}

export function LspServerForm({
	initial,
	scope,
	repoPath,
	onScopeChange,
	onSave,
	onCancel,
	saving,
	error,
	isEdit,
}: LspServerFormProps) {
	const [form, setForm] = useState<ServerFormData>(initial);
	const [showAdvanced, setShowAdvanced] = useState(false);

	const update = (field: keyof ServerFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
	};

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
							className={`text-[12px] font-medium ${scope === "repo" ? "text-[#ff9f0a]" : "text-[var(--text-tertiary)]"}`}
						>
							This Repo
						</div>
						<div className="truncate text-[9px] text-[var(--text-quaternary)]">
							{repoPath ?? "No active workspace"}
						</div>
					</button>
				</div>
			</div>

			{/* Basic fields */}
			<FormField label="Command" value={form.command} onChange={(v) => update("command", v)} mono />
			<FormField label="Arguments" value={form.args} onChange={(v) => update("args", v)} mono />
			<FormField
				label="File Extensions"
				value={form.fileExtensions}
				onChange={(v) => update("fileExtensions", v)}
				mono
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
							onChange={(e) => update("initializationOptions", e.target.value)}
							className="h-[50px] w-full resize-y rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)] focus:outline-none"
						/>
					</div>
				</div>
			</details>

			{/* Error */}
			{error && (
				<div className="mb-3 rounded-[6px] bg-[rgba(255,69,58,0.1)] px-3 py-2 text-[11px] text-[#ff453a]">
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
					disabled={saving || !form.command.trim()}
					onClick={() => onSave(form)}
					className="rounded-[6px] bg-[#0a84ff] px-4 py-1.5 text-[12px] text-white disabled:opacity-50"
				>
					{saving ? "Saving..." : isEdit ? "Save Changes" : "Add Server"}
				</button>
			</div>
		</div>
	);
}

function FormField({
	label,
	value,
	onChange,
	mono,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	mono?: boolean;
}) {
	return (
		<div className="mb-3">
			<div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
				{label}
			</div>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className={`w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--text)] focus:outline-none ${mono ? "font-mono" : ""}`}
			/>
		</div>
	);
}
