import { describe, expect, test } from "bun:test";
import {
	configToFormData,
	formDataToConfig,
} from "../src/renderer/components/settings/lsp/config-form-bridge";
import type { LanguageServerConfig } from "../src/shared/lsp-schema";

describe("config ⇄ form round-trip", () => {
	test("Dockerfile preset preserves fileNames", () => {
		const original: LanguageServerConfig = {
			id: "dockerfile",
			command: "docker-langserver",
			args: ["--stdio"],
			languages: ["dockerfile"],
			fileExtensions: [],
			fileNames: ["Dockerfile"],
			rootMarkers: ["Dockerfile", ".git"],
			disabled: false,
		};

		const formData = configToFormData(original);
		const roundTripped = formDataToConfig(formData, original);

		expect(roundTripped.fileNames).toEqual(["Dockerfile"]);
	});

	test("preserves disabled=true across edit cycle", () => {
		const original: LanguageServerConfig = {
			id: "foo-lang",
			command: "foo-ls",
			args: [],
			languages: ["foo"],
			fileExtensions: [".foo"],
			fileNames: [],
			rootMarkers: [".git"],
			disabled: true,
		};

		const formData = configToFormData(original);
		const roundTripped = formDataToConfig(formData, original);

		expect(roundTripped.disabled).toBe(true);
	});

	test("edits to fileNames field flow through", () => {
		const original: LanguageServerConfig = {
			id: "makefile",
			command: "some-ls",
			args: [],
			languages: ["makefile"],
			fileExtensions: [],
			fileNames: ["Makefile"],
			rootMarkers: [".git"],
			disabled: false,
		};

		const formData = configToFormData(original);
		formData.fileNames = "Makefile, GNUmakefile";
		const roundTripped = formDataToConfig(formData, original);

		expect(roundTripped.fileNames).toEqual(["Makefile", "GNUmakefile"]);
	});

	test("invalid init-opts JSON preserves previous parsed value from original", () => {
		const original: LanguageServerConfig = {
			id: "foo-lang",
			command: "foo-ls",
			args: [],
			languages: ["foo"],
			fileExtensions: [".foo"],
			fileNames: [],
			rootMarkers: [".git"],
			initializationOptions: { existing: true },
			disabled: false,
		};

		const formData = configToFormData(original);
		formData.initializationOptions = "{ broken json";
		const roundTripped = formDataToConfig(formData, original);

		// Parse failures must not silently blow away the previous value
		expect(roundTripped.initializationOptions).toEqual({ existing: true });
	});

	test("empty init-opts string clears the field", () => {
		const original: LanguageServerConfig = {
			id: "foo-lang",
			command: "foo-ls",
			args: [],
			languages: ["foo"],
			fileExtensions: [".foo"],
			fileNames: [],
			rootMarkers: [".git"],
			initializationOptions: { existing: true },
			disabled: false,
		};

		const formData = configToFormData(original);
		formData.initializationOptions = "";
		const roundTripped = formDataToConfig(formData, original);

		expect(roundTripped.initializationOptions).toBeUndefined();
	});
});
