import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	Event: browser.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
let input: unknown;
let error: Error | null = null;
mock.module("../src/renderer/stores/tab-store", () => ({
	useTabStore: { getState: () => ({ setSidebarSegment: () => undefined }) },
}));
mock.module("../src/renderer/trpc/client", () => ({
	trpc: {
		activityQueue: {
			ticketDetail: {
				useQuery: (value: unknown) => {
					input = value;
					return {
						isPending: false,
						error,
						data: {
							issue: {
								provider: "jira",
								groupName: "Swarm",
								identifier: "SUP-39",
								title: "Clear queue context",
								url: "https://a.atlassian.net/browse/SUP-39",
								status: { name: "In progress" },
							},
							description: "Read the actual requirements.",
							comments: [
								{ id: "c1", author: "Alex", body: "Please check the callback.", createdAt: 1000 },
							],
						},
					};
				},
			},
		},
	},
}));
const { createRoot } = await import("react-dom/client");
const { openTicketQueueTarget, useQueueTicketStore } = await import(
	"../src/renderer/stores/queue-ticket-store"
);
const { QueueTicketDetail } = await import("../src/renderer/components/tickets/QueueTicketDetail");
let root: Root;
afterEach(async () => {
	await act(() => root?.unmount());
	useQueueTicketStore.getState().close();
	document.body.innerHTML = "";
	error = null;
});
test("Tickets displays exact scoped task/description/comment and never shows retained data after account error", async () => {
	openTicketQueueTarget("source", {
		type: "ticket",
		provider: "jira",
		accountId: "account",
		siteId: "cloud-a",
		ticketId: "SUP-39",
		identifier: "SUP-39",
		groupId: "SUP",
		url: "https://a.atlassian.net/browse/SUP-39",
	});
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() => root.render(<QueueTicketDetail />));
	expect(input).toEqual({
		sourceId: "source",
		provider: "jira",
		accountId: "account",
		siteId: "cloud-a",
		ticketId: "SUP-39",
	});
	expect(document.body.textContent).toContain("Clear queue context");
	expect(document.body.textContent).toContain("Read the actual requirements.");
	expect(document.body.textContent).toContain("Please check the callback.");
	error = Error("Ticket account changed");
	await act(() => root.render(<QueueTicketDetail />));
	expect(document.body.textContent).toContain("Ticket account changed");
	expect(document.body.textContent).not.toContain("Read the actual requirements.");
	const back = document.querySelector("button");
	if (!back) throw Error("Missing Back to Tickets");
	await act(() => back.click());
	expect(useQueueTicketStore.getState().destination).toBeNull();
});
