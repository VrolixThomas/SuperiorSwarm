import { execFile } from "node:child_process";

export function probeCliInPath(cmd: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile("bash", ["-lc", `command -v ${cmd}`], (err, stdout) => {
			resolve(!err && stdout.trim().length > 0);
		});
	});
}
