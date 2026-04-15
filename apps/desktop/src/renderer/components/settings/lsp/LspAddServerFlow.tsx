import { useState } from "react";
import type { LanguageServerConfig, LspPreset } from "../../../../shared/lsp-schema";
import { LspPresetPicker } from "./LspPresetPicker";
import { LspServerForm, type ServerFormData } from "./LspServerForm";

type FlowStep = "pick" | "form";

interface LspAddServerFlowProps {
	presets: LspPreset[];
	existingIds: Set<string>;
	repoPath: string | null;
	onSave: (config: LanguageServerConfig, scope: "user" | "repo") => Promise<void>;
	onCancel: () => void;
	editTarget?: { config: LanguageServerConfig; scope: "user" | "repo" } | null;
}

function configToFormData(config: LanguageServerConfig): ServerFormData {
	return {
		id: config.id,
		command: config.command,
		args: config.args.join(" "),
		fileExtensions: config.fileExtensions.join(", "),
		languages: config.languages.join(", "),
		rootMarkers: config.rootMarkers.join(", "),
		initializationOptions: config.initializationOptions
			? JSON.stringify(config.initializationOptions, null, 2)
			: "{}",
	};
}

function formDataToConfig(data: ServerFormData): LanguageServerConfig {
	let initOpts: Record<string, unknown> | undefined;
	try {
		const parsed = JSON.parse(data.initializationOptions);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			initOpts = parsed;
		}
	} catch {
		// Ignore invalid JSON — leave as undefined
	}

	return {
		id: data.id,
		command: data.command.trim(),
		args: data.args
			.split(/\s+/)
			.map((s) => s.trim())
			.filter(Boolean),
		languages: data.languages
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		fileExtensions: data.fileExtensions
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		rootMarkers: data.rootMarkers
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		initializationOptions: initOpts,
		disabled: false,
	};
}

export function LspAddServerFlow({
	presets,
	existingIds,
	repoPath,
	onSave,
	onCancel,
	editTarget,
}: LspAddServerFlowProps) {
	const isEdit = !!editTarget;
	const [step, setStep] = useState<FlowStep>(isEdit ? "form" : "pick");
	const [formData, setFormData] = useState<ServerFormData>(
		isEdit
			? configToFormData(editTarget.config)
			: {
					id: "",
					command: "",
					args: "",
					fileExtensions: "",
					languages: "",
					rootMarkers: ".git",
					initializationOptions: "{}",
				}
	);
	const [scope, setScope] = useState<"user" | "repo">(editTarget?.scope ?? "user");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handlePresetSelect = (preset: LspPreset) => {
		setFormData(configToFormData(preset.config));
		setStep("form");
	};

	const handleCustom = () => {
		setFormData({
			id: "",
			command: "",
			args: "",
			fileExtensions: "",
			languages: "",
			rootMarkers: ".git",
			initializationOptions: "{}",
		});
		setStep("form");
	};

	const handleSave = async (data: ServerFormData) => {
		setSaving(true);
		setError(null);
		try {
			await onSave(formDataToConfig(data), scope);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save");
		} finally {
			setSaving(false);
		}
	};

	if (step === "pick") {
		return (
			<LspPresetPicker
				presets={presets}
				existingIds={existingIds}
				onSelect={handlePresetSelect}
				onCustom={handleCustom}
				onCancel={onCancel}
			/>
		);
	}

	return (
		<LspServerForm
			initial={formData}
			scope={scope}
			repoPath={repoPath}
			onScopeChange={setScope}
			onSave={handleSave}
			onCancel={onCancel}
			saving={saving}
			error={error}
			isEdit={isEdit}
		/>
	);
}
