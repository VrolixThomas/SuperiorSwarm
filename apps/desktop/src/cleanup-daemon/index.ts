import { fstatSync, ftruncateSync } from "node:fs";
import { runCleanupWorker } from "./worker";

try {
	if (fstatSync(1).size > 1_000_000) ftruncateSync(1, 0);
} catch {
	// Log rotation is best-effort and happens in the isolated process.
}

const dbPath = process.env["SUPERIORSWARM_DB_PATH"];
if (!dbPath) {
	console.error("[cleanup-daemon] SUPERIORSWARM_DB_PATH is required");
	process.exit(1);
}

runCleanupWorker(dbPath).then(
	() => process.exit(0),
	(error) => {
		console.error("[cleanup-daemon] fatal error:", error);
		process.exit(1);
	}
);
