import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { type ReactNode, act, createElement } from "react";
import { trpc } from "../../src/renderer/trpc/client";
import { ipcLink } from "../../src/renderer/trpc/ipc-link";
import type { RepoInvalidateEvent } from "../../src/shared/types";

const dom = new Window();
Object.assign(globalThis, {
	window: dom,
	document: dom.document,
	navigator: dom.navigator,
	HTMLElement: dom.HTMLElement,
	CSS: dom.CSS,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
	IS_REACT_ACT_ENVIRONMENT: true,
});
dom.HTMLElement.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");

export async function renderBrowserTest(
	node: ReactNode,
	entries = [{ path: ".env", type: "file" }],
	fail = false,
	options: {
		request?: (path: string, input: unknown) => unknown;
		electron?: Record<string, unknown>;
		retry?: boolean | number;
		seedQueries?: (client: QueryClient) => void;
	} = {}
) {
	const calls: { path: string; input: unknown }[] = [];
	const lifecycle: string[] = [];
	const listeners = new Set<(event: RepoInvalidateEvent) => void>();
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: options.retry ?? false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	options.seedQueries?.(queryClient);
	Object.assign(dom, {
		electron: {
			repo: {
				subscribe: async (root: string) => {
					lifecycle.push(`subscribe:${root}:${listeners.size}`);
				},
				unsubscribe: async (root: string) => {
					lifecycle.push(`unsubscribe:${root}`);
				},
				onInvalidate: (listener: (event: RepoInvalidateEvent) => void) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			},
			trpc: {
				request: async ({ path, input }: { path: string; input: unknown }) => {
					calls.push({ path, input });
					if (options.request) return { result: { data: await options.request(path, input) } };
					if (path === "diff.listAllFiles")
						return fail
							? { error: { message: "Listing failed", code: "INTERNAL_SERVER_ERROR" } }
							: { result: { data: { entries } } };
					if (path === "diff.getWorkingTreeStatus")
						return { result: { data: { stagedFiles: [], unstagedFiles: [] } } };
					throw new Error(`Unexpected request: ${path}`);
				},
			},
			...options.electron,
		},
	});
	const client = trpc.createClient({ links: [ipcLink()] });
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const wrap = (child: ReactNode) =>
		createElement(trpc.Provider, {
			client,
			queryClient,
			// biome-ignore lint/correctness/noChildrenProp: tRPC Provider requires children in its typed props
			children: createElement(QueryClientProvider, { client: queryClient }, child),
		});
	const settle = async () => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 15));
		});
	};
	await act(async () => {
		root.render(wrap(node));
	});
	await settle();
	return {
		container,
		calls,
		queryClient,
		lifecycle,
		listeners,
		settle,
		async rerender(child: ReactNode) {
			await act(async () => {
				root.render(wrap(child));
			});
			await settle();
		},
		async cleanup() {
			await act(async () => root.unmount());
			queryClient.clear();
			container.remove();
		},
	};
}
