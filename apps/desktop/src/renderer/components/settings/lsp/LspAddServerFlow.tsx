import { useState } from "react";
import type {
	LanguageServerConfig,
	LspDetectSuggestion,
	LspPreset,
} from "../../../../shared/lsp-schema";
import { LspPresetPicker } from "./LspPresetPicker";
import { LspServerForm, type ServerFormData } from "./LspServerForm";
import { configToFormData, formDataToConfig } from "./config-form-bridge";
import { ConfigFieldErrors } from "./lsp-errors";

type FlowStep = "pick" | "form";

interface LspAddServerFlowProps {
	presets: LspPreset[];
	existingIds: Set<string>;
	builtInIds: Set<string>;
	suggestions?: LspDetectSuggestion[];
	repoPath: string | null;
	onSave: (config: LanguageServerConfig, scope: "user" | "repo") => Promise<void>;
	onCancel: () => void;
	editTarget?: { config: LanguageServerConfig; scope: "user" | "repo" } | null;
}

const EMPTY_FORM_DATA: ServerFormData = {
	id: "",
	command: "",
	args: "",
	fileExtensions: "",
	fileNames: "",
	languages: "",
	rootMarkers: ".git",
	initializationOptions: "",
};

export function LspAddServerFlow({
	presets,
	existingIds,
	builtInIds,
	suggestions,
	repoPath,
	onSave,
	onCancel,
	editTarget,
}: LspAddServerFlowProps) {
	const isEdit = !!editTarget;
	const [step, setStep] = useState<FlowStep>(isEdit ? "form" : "pick");
	const [originalConfig, setOriginalConfig] = useState<LanguageServerConfig | null>(
		editTarget?.config ?? null
	);
	const [formData, setFormData] = useState<ServerFormData>(
		isEdit ? configToFormData(editTarget.config) : EMPTY_FORM_DATA
	);
	const [scope, setScope] = useState<"user" | "repo">(editTarget?.scope ?? "user");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

	const handlePresetSelect = (preset: LspPreset) => {
		setOriginalConfig(preset.config);
		setFormData(configToFormData(preset.config));
		setStep("form");
	};

	const handleQuickAdd = async (preset: LspPreset) => {
		setSaving(true);
		setError(null);
		try {
			await onSave(preset.config, scope);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save");
		} finally {
			setSaving(false);
		}
	};

	const handleCustom = () => {
		setOriginalConfig(null);
		setFormData(EMPTY_FORM_DATA);
		setStep("form");
	};

	const handleSave = async (data: ServerFormData) => {
		setSaving(true);
		setError(null);
		setFieldErrors(null);
		try {
			await onSave(formDataToConfig(data, originalConfig), scope);
		} catch (err) {
			if (err instanceof ConfigFieldErrors) {
				setFieldErrors(err.fieldErrors);
				setError(null);
			} else {
				setError(err instanceof Error ? err.message : "Failed to save");
			}
		} finally {
			setSaving(false);
		}
	};

	if (step === "pick") {
		return (
			<LspPresetPicker
				presets={presets}
				existingIds={existingIds}
				suggestions={suggestions}
				onSelect={handlePresetSelect}
				onQuickAdd={handleQuickAdd}
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
			existingIds={existingIds}
			builtInIds={builtInIds}
			onScopeChange={setScope}
			onSave={handleSave}
			onCancel={onCancel}
			saving={saving}
			error={error}
			fieldErrors={fieldErrors}
			isEdit={isEdit}
		/>
	);
}
