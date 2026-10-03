import { expect, test } from "bun:test";
import { getQueryKey } from "@trpc/react-query";
import { act, createElement } from "react";
import { useRepoSubscription } from "../src/renderer/hooks/useRepoSubscription";
import { trpc } from "../src/renderer/trpc/client";
import { renderBrowserTest } from "./helpers/file-browser-renderer";

function Subscriber({ root }: { root: string }) {
	useRepoSubscription(root);
	return null;
}

test("repository events invalidate both listing modes/directories only for the subscribed root", async () => {
	const h = await renderBrowserTest(createElement(Subscriber, { root: "/fixture/a" }));
	try {
		const keys = ["/fixture/a", "/fixture/b"].flatMap((repoPath) => [
			getQueryKey(trpc.diff.listAllFiles, { repoPath }, "query"),
			getQueryKey(trpc.diff.listAllFiles, { repoPath, mode: "browser" }, "query"),
			getQueryKey(
				trpc.diff.listDirectory,
				{ repoPath, dirPath: "nested", mode: "browser" },
				"query"
			),
		]);
		for (const kind of ["working-tree", "index", "head"] as const) {
			for (const key of keys) h.queryClient.setQueryData(key, { entries: [] });
			await act(async () => {
				for (const listener of h.listeners) listener({ repoPath: "/fixture/a", kinds: [kind] });
			});
			for (const key of keys.slice(0, 3))
				expect(h.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
			for (const key of keys.slice(3))
				expect(h.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
		}
	} finally {
		await h.cleanup();
	}
});

test("listener is installed before subscription and is removed on root switch/unmount", async () => {
	const h = await renderBrowserTest(createElement(Subscriber, { root: "/fixture/a" }));
	try {
		expect(h.lifecycle).toContain("subscribe:/fixture/a:1");
		await h.rerender(createElement(Subscriber, { root: "/fixture/b" }));
		expect(h.lifecycle).toContain("unsubscribe:/fixture/a");
		expect(h.listeners.size).toBe(1);
	} finally {
		await h.cleanup();
	}
	expect(h.lifecycle).toContain("unsubscribe:/fixture/b");
	expect(h.listeners.size).toBe(0);
});
