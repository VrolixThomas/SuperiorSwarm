import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

function copyMigrationsPlugin() {
	return {
		name: "copy-drizzle-migrations",
		closeBundle() {
			const src = resolve(__dirname, "src/main/db/migrations");
			const dest = resolve(__dirname, "out/main/db/migrations");

			if (!existsSync(src)) return;

			function copyDir(srcDir: string, destDir: string) {
				if (!existsSync(destDir)) {
					mkdirSync(destDir, { recursive: true });
				}
				for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
					const srcPath = join(srcDir, entry.name);
					const destPath = join(destDir, entry.name);
					if (entry.isDirectory()) {
						copyDir(srcPath, destPath);
					} else {
						copyFileSync(srcPath, destPath);
					}
				}
			}

			copyDir(src, dest);
		},
	};
}

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin(), copyMigrationsPlugin()],
		define: {
			"process.env.JIRA_CLIENT_ID": JSON.stringify(process.env.JIRA_CLIENT_ID ?? ""),
			"process.env.JIRA_CLIENT_SECRET": JSON.stringify(process.env.JIRA_CLIENT_SECRET ?? ""),
			"process.env.BITBUCKET_CLIENT_ID": JSON.stringify(process.env.BITBUCKET_CLIENT_ID ?? ""),
			"process.env.BITBUCKET_CLIENT_SECRET": JSON.stringify(process.env.BITBUCKET_CLIENT_SECRET ?? ""),
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/main/index.ts"),
				},
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/preload/index.ts"),
				},
				output: {
					format: "cjs",
					entryFileNames: "[name].cjs",
				},
			},
		},
	},
	renderer: {
		plugins: [react()],
		resolve: {
			alias: {
				"@": resolve(__dirname, "src/renderer"),
			},
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/renderer/index.html"),
				},
			},
		},
	},
});
