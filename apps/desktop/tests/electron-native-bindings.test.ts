import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

test("installed Electron loads desktop/MCP SQLite, applies migrations and spawns a PTY", async () => {
	const electronDir = dirname(require.resolve("electron/package.json"));
	const executable = join(
		electronDir,
		"dist",
		(await readFile(join(electronDir, "path.txt"), "utf8")).trim()
	);
	const database = dirname(require.resolve("better-sqlite3/package.json"));
	const drizzle = dirname(require.resolve("drizzle-orm/package.json"));
	const code = `
const assert=require('node:assert/strict');
const DB=require(process.argv[1]),MCP=require(process.argv[2]),pty=require(process.argv[3]);
const {drizzle}=require(process.argv[4]),{migrate}=require(process.argv[5]);
const db=new DB(':memory:');migrate(drizzle(db),{migrationsFolder:process.argv[6]});
db.exec('CREATE TABLE native_probe (id INTEGER PRIMARY KEY, value TEXT)');
db.prepare('INSERT INTO native_probe(value) VALUES(?)').run('electron-native-ok');
assert.equal(db.prepare('SELECT value FROM native_probe').get().value,'electron-native-ok');db.close();
const mcp=new MCP(':memory:');assert.equal(mcp.prepare('SELECT 42 AS value').get().value,42);mcp.close();
const timer=setTimeout(()=>{console.error('PTY timed out');process.exit(1)},10000);
let output='';const term=pty.spawn('/bin/sh',['-c','printf native-pty-ok'],{name:'xterm-256color',cols:80,rows:24,cwd:process.cwd(),env:{PATH:'/usr/bin:/bin',TERM:'xterm-256color'}});
term.onData(data=>{output+=data});term.onExit(({exitCode})=>{clearTimeout(timer);assert.equal(exitCode,0);assert.ok(output.includes('native-pty-ok'));console.log(JSON.stringify({electron:process.versions.electron,abi:process.versions.modules,sqlite:true,mcp:true,migrations:true,pty:true}));});
`;
	const child = Bun.spawn(
		[
			executable,
			"-e",
			code,
			database,
			resolve(import.meta.dir, "../mcp-standalone/node_modules/better-sqlite3"),
			dirname(require.resolve("node-pty/package.json")),
			join(drizzle, "better-sqlite3/index.cjs"),
			join(drizzle, "better-sqlite3/migrator.cjs"),
			resolve(import.meta.dir, "../src/main/db/migrations"),
		],
		{
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		}
	);
	const timeout = setTimeout(() => child.kill(), 20000);
	try {
		const [status, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (status !== 0) throw Error(`Native validation failed (${status})\n${stdout}\n${stderr}`);
		const report = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
		expect(report).toMatchObject({
			electron: "45.4.1",
			sqlite: true,
			mcp: true,
			migrations: true,
			pty: true,
		});
	} finally {
		clearTimeout(timeout);
		child.kill();
	}
}, 25000);
