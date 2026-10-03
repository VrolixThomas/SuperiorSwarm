import { realpathSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import {
	FILE_PASTE_MAX_BYTES,
	FILE_PATH_MAX_BYTES,
	isFilePaste,
} from "../../../shared/terminal-files";
import { getWorkspaceCwdOrThrow } from "../../agent-launch/workspace-cwd-lookup";
import { getAgentSessionManager } from "../../services/agent-session-manager-handle";
import { getDaemonClient } from "../../terminal/daemon-instance";
import { TerminalAttachmentStore } from "../../terminal/terminal-attachments";
import { TerminalFileService, terminalFileOwners } from "../../terminal/terminal-files";
import { publicProcedure, router } from "../index";

const service = new TerminalFileService(terminalFileOwners);
let store: TerminalAttachmentStore | undefined;
const copies = () => {
	store ??= new TerminalAttachmentStore(
		join(app.getPath("userData"), "terminal-files"),
		join(__dirname.replace("app.asar/", "app.asar.unpacked/"), "terminal-file-copy")
	);
	return store;
};
const leases = new Map<
	string,
	{
		generation: string;
		supported: boolean;
		expires: number;
		requestedSubmit?: boolean;
		atomicSubmit?: boolean;
	}
>();
const progress = new Map<string, number>();
const id = z.string().min(1).max(200);
const batchInput = z.object({ batchId: id });
const selection = batchInput.extend({
	ids: z.array(id).min(1).max(64),
	submit: z.boolean().optional(),
});
const targetInput = z.object({ terminalId: id });
const fileProcedure = publicProcedure.use(({ ctx, next }) => {
	if (!ctx.fileCaller) throw new Error("Terminal file caller is not authorized.");
	return next({ ctx: { ...ctx, fileCaller: ctx.fileCaller } });
});
function target(terminalId: string, caller: { senderId: number; frameId: number }) {
	const current = terminalFileOwners.target(terminalId, caller);
	if (realpathSync(getWorkspaceCwdOrThrow(current.workspaceId)) !== current.root)
		throw new Error("Workspace root changed. Reopen the terminal.");
	return current;
}
function ready(terminalId: string, explicitSubmit = false): void {
	const state = getAgentSessionManager()?.getSession(terminalId)?.state;
	// Ordinary draft typing calls beforeTerminalInput and marks an idle agent running.
	// A user-requested send must not mistake that bookkeeping for an unavailable prompt.
	if (state && state !== "idle" && !(explicitSubmit && state === "running"))
		throw new Error(
			"Bring an idle local prompt into view first. File sends never wake sleeping sessions or answer approval prompts."
		);
	if (!getDaemonClient()?.isConnected)
		throw new Error("Terminal disconnected. Drop files again after reconnecting.");
}
export const terminalFilesRouter = router({
	prepare: fileProcedure
		.input(
			targetInput.extend({
				paths: z.array(z.string().max(FILE_PATH_MAX_BYTES).nullable()).min(1).max(64),
			})
		)
		.mutation(async ({ ctx, input }) => {
			const bound = target(input.terminalId, ctx.fileCaller);
			const managedAgent = getAgentSessionManager()?.getSession(input.terminalId)?.managed === true;
			const daemonTarget = await getDaemonClient()?.fileTarget(input.terminalId, managedAgent);
			terminalFileOwners.assert(ctx.fileCaller, bound);
			const batch = await service.prepare(ctx.fileCaller, bound, input.paths);
			for (const [key, lease] of leases) if (lease.expires < Date.now()) leases.delete(key);
			if (leases.size >= 128) leases.delete(leases.keys().next().value as string);
			if (daemonTarget)
				leases.set(batch.id, { ...daemonTarget, expires: Date.now() + 10 * 60 * 1000 });
			return batch;
		}),
	append: fileProcedure
		.input(
			batchInput.extend({
				paths: z.array(z.string().max(FILE_PATH_MAX_BYTES).nullable()).min(1).max(64),
				retainedIds: z.array(id).max(64),
			})
		)
		.mutation(async ({ ctx, input }) => {
			const bound = service.batchTarget(ctx.fileCaller, input.batchId);
			target(bound.terminalId, ctx.fileCaller);
			// Retain the original daemon generation; adding a file never obtains a new lease.
			return service.append(ctx.fileCaller, input.batchId, input.paths, input.retainedIds);
		}),
	resolve: fileProcedure.input(selection).mutation(async ({ ctx, input }) => {
		const result = await service.resolve(ctx.fileCaller, input.batchId, input.ids);
		target(result.target.terminalId, ctx.fileCaller);
		ready(result.target.terminalId, input.submit);
		const lease = leases.get(input.batchId);
		if (!lease?.supported)
			throw new Error(
				"This prompt or terminal service could not be verified. Use Copy paths, then paste into your local prompt. Remote access remains unverified. No paths were sent."
			);
		lease.requestedSubmit = input.submit === true;
		lease.atomicSubmit = lease.requestedSubmit && getDaemonClient()?.supportsFileSubmit === true;
		return { ...result, submit: lease.atomicSubmit };
	}),
	copyPaths: fileProcedure.input(selection).mutation(async ({ ctx, input }) => {
		// Clipboard text is explicitly reviewed/pasted by the user. It does not grant a PTY lease.
		const result = await service.resolve(ctx.fileCaller, input.batchId, input.ids);
		target(result.target.terminalId, ctx.fileCaller);
		return result.text;
	}),
	insert: fileProcedure
		.input(
			batchInput.extend({
				text: z.string().max(FILE_PASTE_MAX_BYTES),
				payload: z.string().max(FILE_PASTE_MAX_BYTES + 12),
				submit: z.boolean().optional(),
			})
		)
		.mutation(async ({ ctx, input }) => {
			if (!isFilePaste(input.text, input.payload))
				throw new Error("Unexpected terminal paste payload.");
			const lease = leases.get(input.batchId);
			if (!lease || lease.requestedSubmit !== (input.submit === true))
				throw new Error("Prepare this file action again before sending.");
			const bound = service.consume(ctx.fileCaller, input.batchId, input.text);
			leases.delete(input.batchId);
			target(bound.terminalId, ctx.fileCaller);
			ready(bound.terminalId, input.submit);
			terminalFileOwners.assert(ctx.fileCaller, bound);
			if (!lease?.supported || lease.expires < Date.now()) return "rejected" as const;
			return (
				(await getDaemonClient()?.insertFiles(
					bound.terminalId,
					lease.generation,
					input.text,
					input.payload,
					lease.atomicSubmit
				)) ?? "rejected"
			);
		}),
	copy: fileProcedure.input(batchInput.extend({ id })).mutation(async ({ ctx, input }) => {
		const source = service.copySource(ctx.fileCaller, input.batchId, input.id);
		target(source.target.terminalId, ctx.fileCaller);
		source.entry.referenceAllowed = false;
		progress.set(input.batchId, 0);
		try {
			const copy = await copies().copy(
				source.target.workspaceId,
				source.target.root,
				source.snapshot,
				source.entry.label,
				source.signal,
				(bytes) => progress.set(input.batchId, bytes)
			);
			return await service.copied(ctx.fileCaller, input.batchId, input.id, copy.id, copy.path);
		} finally {
			progress.delete(input.batchId);
		}
	}),
	progress: fileProcedure.input(batchInput.extend({ id })).query(({ ctx, input }) => {
		service.copySource(ctx.fileCaller, input.batchId, input.id);
		return progress.get(input.batchId) ?? 0;
	}),
	cancel: fileProcedure.input(batchInput).mutation(({ ctx, input }) => {
		service.cancel(ctx.fileCaller, input.batchId);
		leases.delete(input.batchId);
	}),
	listCopies: fileProcedure.input(targetInput).query(({ ctx, input }) => {
		const bound = target(input.terminalId, ctx.fileCaller);
		return copies().list(bound.workspaceId, bound.root);
	}),
	deleteCopy: fileProcedure.input(targetInput.extend({ id })).mutation(({ ctx, input }) => {
		const bound = target(input.terminalId, ctx.fileCaller);
		return copies().delete(bound.workspaceId, bound.root, input.id);
	}),
});
