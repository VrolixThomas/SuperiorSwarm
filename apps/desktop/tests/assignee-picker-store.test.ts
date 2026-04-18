import { beforeEach, expect, test } from "bun:test";
import { useAssigneePickerStore } from "../src/renderer/stores/assignee-picker-store";
import type { MergedTicketIssue } from "../src/shared/tickets";

const ticket = { id: "t1", provider: "linear" } as MergedTicketIssue;

beforeEach(() => useAssigneePickerStore.setState({ open: null }));

test("opens with ticket and position", () => {
	useAssigneePickerStore.getState().openFor(ticket, { x: 10, y: 20 });
	expect(useAssigneePickerStore.getState().open).toEqual({ ticket, position: { x: 10, y: 20 } });
});

test("close resets to null", () => {
	useAssigneePickerStore.getState().openFor(ticket, { x: 0, y: 0 });
	useAssigneePickerStore.getState().close();
	expect(useAssigneePickerStore.getState().open).toBeNull();
});
