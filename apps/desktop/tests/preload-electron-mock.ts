import { mock } from "bun:test";

mock.module("electron", () => ({
	safeStorage: {
		isEncryptionAvailable: () => false,
		encryptString: (s: string) => Buffer.from(s),
		decryptString: (b: Buffer) => b.toString(),
	},
	app: {
		getPath: (_name: string) => `/tmp/branchflux-test-${process.pid}`,
		isPackaged: false,
	},
	ipcMain: {
		handle: () => {},
		on: () => {},
	},
	shell: {
		openExternal: async () => {},
	},
	BrowserWindow: class {},
	dialog: {
		showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
	},
}));
