import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PtyManager } from "../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../src/daemon/scrollback-store";
import { SocketServer } from "../../src/daemon/socket-server";
import { DaemonClient } from "../../src/main/terminal/daemon-client";

const root = mkdtempSync(join(tmpdir(), "ss-attach-only-"));
const manager = new PtyManager();
const create = manager.create.bind(manager);
const attach = manager.attach.bind(manager);
let creates = 0;
let vanishOnAttach: string | undefined;
manager.create = (...args) => {
	creates++;
	return create(...args);
};
manager.attach = (...args) => {
	if (args[0] === vanishOnAttach) manager.dispose(args[0]);
	return attach(...args);
};
const socket = join(root, "daemon.sock");
const server = new SocketServer(manager, { flush: () => [] } as unknown as ScrollbackStore, socket);
const client = new DaemonClient(socket, join(root, "pid"), join(root, "log"));
server.listen();
try {
	await client.connect();
	for (const id of ["target", "sibling"]) {
		await client.create(
			id,
			root,
			() => {},
			() => {}
		);
	}
	assert.equal((await client.listSessionsStrict()).length, 2);
	assert.equal(creates, 2);
	// Both target and another restored pane pass preflight, then vanish exactly
	// at the daemon's atomic attach lookup. Neither may launch a replacement.
	for (const id of ["target", "sibling"]) {
		vanishOnAttach = id;
		await assert.rejects(
			client.attach(
				id,
				() => {},
				() => {},
				root,
				undefined,
				"attach-existing-only"
			),
			(error: unknown) => (error as { code?: string }).code === "TERMINAL_NOT_RUNNING"
		);
		assert.equal(manager.has(id), false);
		assert.equal(creates, 2);
	}
	vanishOnAttach = undefined;
	await client.create(
		"ordinary",
		root,
		() => {},
		() => {}
	);
	await client.listSessionsStrict();
	assert.equal(manager.has("ordinary"), true);
	assert.equal(creates, 3);
	await client.attach(
		"ordinary",
		() => {},
		() => {},
		root,
		undefined,
		"attach-existing-only"
	);
	assert.equal(creates, 3);
	// Ordinary attach's historical missing-session fallback remains supported.
	manager.dispose("ordinary");
	await client.attach(
		"ordinary",
		() => {},
		() => {},
		root
	);
	for (let i = 0; i < 100 && !manager.has("ordinary"); i++) await delay(10);
	assert.equal(manager.has("ordinary"), true);
	assert.equal(creates, 4);
	console.log(
		"atomic attach-only blocked target and sibling replacement; ordinary creation preserved"
	);
} finally {
	client.disconnect();
	server.close();
	manager.disposeAll();
	rmSync(root, { recursive: true, force: true });
}
