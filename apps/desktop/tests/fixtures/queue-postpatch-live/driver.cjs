// Real CLI print/exec adapter: changes invocation mode only; never emits provider hooks.
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const launch = process.argv.slice(3);
let session = config.sessionId;
let turn = 0;
const rl = readline.createInterface({ input: process.stdin });
async function run(prompt) {
	const args = [...config.base];
	if (turn)
		args.push(...(config.provider === "claude" ? ["--resume", session] : ["resume", session]));
	else if (config.provider === "claude" && session) args.push("--session-id", session);
	args.push(prompt);
	let output = "";
	const child = spawn(config.command, args, {
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (d) => {
		output += String(d);
	});
	child.stderr.on("data", (d) => {
		output += String(d);
	});
	const timer = setTimeout(() => child.kill("SIGTERM"), 45000);
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	clearTimeout(timer);
	for (const line of output.split("\n")) {
		try {
			const e = JSON.parse(line);
			session = e.thread_id ?? e.session_id ?? session;
		} catch {}
	}
	turn++;
	fs.writeFileSync(
		config.result,
		JSON.stringify({
			code,
			session,
			turn,
			question: output.includes("Which color: amber or blue?"),
			followup: output.includes("COLOR_BLUE_DONE"),
		})
	);
	console.log(`NATIVE_LIVE_TURN_${turn}`);
	if (code !== 0) process.exit(code || 1);
}
(async () => {
	await run(launch.at(-1));
	for await (const line of rl) {
		if (line === "__fixture_exit__") break;
		await run(line);
	}
	process.exit(0);
})().catch(() => process.exit(1));
