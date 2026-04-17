import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/main/db";

async function setCliPreset(preset: "claude" | "gemini" | "codex" | "opencode"): Promise<void> {
	const schema = await import("../src/main/db/schema");
	const { eq } = await import("drizzle-orm");
	const db = getDb();
	const existing = db
		.select()
		.from(schema.aiReviewSettings)
		.where(eq(schema.aiReviewSettings.id, "default"))
		.get();
	if (existing) {
		db.update(schema.aiReviewSettings)
			.set({ cliPreset: preset, updatedAt: new Date() })
			.where(eq(schema.aiReviewSettings.id, "default"))
			.run();
	} else {
		db.insert(schema.aiReviewSettings)
			.values({
				id: "default",
				cliPreset: preset,
				autoReviewEnabled: 0,
				skipPermissions: 1,
				maxConcurrentReviews: 3,
				updatedAt: new Date(),
			})
			.run();
	}
}

let repoPath: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(() => {
	repoPath = mkdtempSync(join(tmpdir(), "ss-lsp-install-"));
});

afterEach(() => {
	rmSync(repoPath, { recursive: true, force: true });
});

describe("launchInstallAgent", () => {
	test("writes a launch script invoking the configured CLI command", async () => {
		await setCliPreset("claude");
		const { launchInstallAgent } = await import("../src/main/lsp/agent-install");

		const { launchScript } = await launchInstallAgent({
			repoPath,
			configId: "csharp",
			displayName: "C#",
			candidateBinaries: ["OmniSharp", "csharp-ls"],
		});

		expect(existsSync(launchScript)).toBe(true);
		const script = readFileSync(launchScript, "utf-8");
		expect(script).toContain("claude");
		expect(script).toContain('cd -- "$1"');
	});

	test("uses --yolo permission flag when preset is gemini", async () => {
		await setCliPreset("gemini");
		const { launchInstallAgent } = await import("../src/main/lsp/agent-install");

		const { launchScript } = await launchInstallAgent({
			repoPath,
			configId: "csharp",
			displayName: "C#",
			candidateBinaries: ["OmniSharp"],
		});

		const script = readFileSync(launchScript, "utf-8");
		expect(script).toContain("gemini");
		expect(script).toContain("--yolo");
	});

	test("writes a prompt file that references the config id and candidate binaries", async () => {
		await setCliPreset("claude");
		const { launchInstallAgent } = await import("../src/main/lsp/agent-install");

		const { promptFilePath } = await launchInstallAgent({
			repoPath,
			configId: "csharp",
			displayName: "C#",
			candidateBinaries: ["OmniSharp", "csharp-ls"],
		});

		expect(existsSync(promptFilePath)).toBe(true);
		const prompt = readFileSync(promptFilePath, "utf-8");
		expect(prompt).toContain("C#");
		expect(prompt).toContain("OmniSharp");
		expect(prompt).toContain("csharp-ls");
	});

	test("does NOT write .mcp.json to the repo", async () => {
		await setCliPreset("claude");
		const { launchInstallAgent } = await import("../src/main/lsp/agent-install");

		await launchInstallAgent({
			repoPath,
			configId: "csharp",
			displayName: "C#",
			candidateBinaries: ["OmniSharp"],
		});

		expect(existsSync(join(repoPath, ".mcp.json"))).toBe(false);
	});

	test("prompt asks the agent to present options and wait for user choice", async () => {
		await setCliPreset("claude");
		const { launchInstallAgent } = await import("../src/main/lsp/agent-install");

		const { promptFilePath } = await launchInstallAgent({
			repoPath,
			configId: "rust",
			displayName: "Rust",
			candidateBinaries: ["rust-analyzer"],
		});

		const prompt = readFileSync(promptFilePath, "utf-8");
		// Must not dictate an install method — must ask the user
		expect(prompt.toLowerCase()).toContain("ask");
		// Should mention verifying the install
		expect(prompt.toLowerCase()).toMatch(/verif|--version/);
	});
});
