import { describe, expect, mock, test } from "bun:test";

// ── Mock getAuth ────────────────────────────────────────────────────────────

const mockGetAuth = mock(() => null as object | null);

mock.module("../src/main/linear/auth", () => ({
	getAuth: mockGetAuth,
}));

// ── Mock Linear API functions ───────────────────────────────────────────────

const mockGetAssignedIssues = mock(async () => []);
const mockGetAssignedIssuesWithDone = mock(async () => []);
const mockGetTeamStates = mock(async () => []);
const mockUpdateIssueState = mock(async () => undefined);
const mockGetIssueDetail = mock(async () => ({
	description: "",
	comments: [],
}));

mock.module("../src/main/linear/linear", () => ({
	getTeamIssues: mockGetAssignedIssues,
	getTeamIssuesWithDone: mockGetAssignedIssuesWithDone,
	getTeamStates: mockGetTeamStates,
	updateIssueState: mockUpdateIssueState,
	getIssueDetail: mockGetIssueDetail,
}));

// ── Import after mocks ──────────────────────────────────────────────────────

const { LinearAdapter } = await import("../src/main/providers/linear-adapter");

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeLinearIssue(
	overrides: Partial<{
		id: string;
		identifier: string;
		title: string;
		url: string;
		stateId: string;
		stateName: string;
		stateColor: string;
		stateType: string;
		teamId: string;
		teamName: string;
	}> = {}
) {
	return {
		id: "issue-1",
		identifier: "ENG-1",
		title: "Fix bug",
		url: "https://linear.app/team/issue/ENG-1",
		stateId: "state-1",
		stateName: "In Progress",
		stateColor: "#f59e0b",
		stateType: "started",
		teamId: "team-1",
		teamName: "Engineering",
		...overrides,
	};
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("LinearAdapter.name", () => {
	test("is 'linear'", () => {
		const adapter = new LinearAdapter();
		expect(adapter.name).toBe("linear");
	});
});

describe("LinearAdapter.isConnected", () => {
	test("returns false when getAuth returns null", () => {
		mockGetAuth.mockReturnValue(null);
		const adapter = new LinearAdapter();
		expect(adapter.isConnected()).toBe(false);
	});

	test("returns true when getAuth returns an object", () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		const adapter = new LinearAdapter();
		expect(adapter.isConnected()).toBe(true);
	});
});

describe("LinearAdapter.getAssignedIssues", () => {
	test("returns [] when not connected", async () => {
		mockGetAuth.mockReturnValue(null);
		const adapter = new LinearAdapter();
		const result = await adapter.getAssignedIssues();
		expect(result).toEqual([]);
	});

	test("calls getAssignedIssues when includeDone is false", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([makeLinearIssue()]);
		const adapter = new LinearAdapter();
		const result = await adapter.getAssignedIssues({ includeDone: false });
		expect(result).toHaveLength(1);
		expect(mockGetAssignedIssues).toHaveBeenCalled();
	});

	test("calls getAssignedIssuesWithDone when includeDone is true", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssuesWithDone.mockResolvedValue([makeLinearIssue()]);
		const adapter = new LinearAdapter();
		const result = await adapter.getAssignedIssues({ includeDone: true });
		expect(result).toHaveLength(1);
		expect(mockGetAssignedIssuesWithDone).toHaveBeenCalled();
	});

	test("passes teamId to getAssignedIssues", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([]);
		const adapter = new LinearAdapter();
		await adapter.getAssignedIssues({ teamId: "team-abc" });
		expect(mockGetAssignedIssues).toHaveBeenCalledWith("team-abc");
	});

	test("passes teamId to getAssignedIssuesWithDone", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssuesWithDone.mockResolvedValue([]);
		const adapter = new LinearAdapter();
		await adapter.getAssignedIssues({ includeDone: true, teamId: "team-abc" });
		expect(mockGetAssignedIssuesWithDone).toHaveBeenCalledWith("team-abc");
	});
});

describe("LinearAdapter issue mapping", () => {
	test("maps all fields correctly", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({
				id: "issue-42",
				identifier: "ENG-42",
				title: "Build feature",
				url: "https://linear.app/team/issue/ENG-42",
				stateName: "In Review",
				stateType: "started",
				stateColor: "#6366f1",
			}),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue).toEqual({
			id: "issue-42",
			identifier: "ENG-42",
			title: "Build feature",
			url: "https://linear.app/team/issue/ENG-42",
			status: "In Review",
			statusCategory: "started",
			statusColor: "#6366f1",
		});
	});

	test("uses empty string fallback for null id", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({ id: undefined as unknown as string }),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue.id).toBe("");
	});

	test("uses empty string fallback for null identifier", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({ identifier: undefined as unknown as string }),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue.identifier).toBe("");
	});

	test("uses empty string fallback for null title", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({ title: undefined as unknown as string }),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue.title).toBe("");
	});

	test("uses empty string fallback for null url", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({ url: undefined as unknown as string }),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue.url).toBe("");
	});

	test("uses empty string fallback for null stateName", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({ stateName: undefined as unknown as string }),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue.status).toBe("");
	});

	test("uses empty string fallback for null stateType", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({ stateType: undefined as unknown as string }),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue.statusCategory).toBe("");
	});

	test("uses #808080 fallback for null stateColor", async () => {
		mockGetAuth.mockReturnValue({ accessToken: "tok", accountId: "acc" });
		mockGetAssignedIssues.mockResolvedValue([
			makeLinearIssue({ stateColor: undefined as unknown as string }),
		]);
		const adapter = new LinearAdapter();
		const [issue] = await adapter.getAssignedIssues();
		expect(issue.statusColor).toBe("#808080");
	});
});

describe("LinearAdapter.getAvailableStates", () => {
	test("returns [] when no teamId provided", async () => {
		const adapter = new LinearAdapter();
		const result = await adapter.getAvailableStates({});
		expect(result).toEqual([]);
	});

	test("returns [] when teamId is undefined", async () => {
		const adapter = new LinearAdapter();
		const result = await adapter.getAvailableStates({ issueId: "issue-1" });
		expect(result).toEqual([]);
	});

	test("calls getTeamStates with the teamId", async () => {
		mockGetTeamStates.mockResolvedValue([
			{ id: "state-1", name: "Todo", color: "#6b7280", type: "unstarted", position: 0 },
			{ id: "state-2", name: "In Progress", color: "#f59e0b", type: "started", position: 1 },
		]);
		const adapter = new LinearAdapter();
		const result = await adapter.getAvailableStates({ teamId: "team-1" });
		expect(mockGetTeamStates).toHaveBeenCalledWith("team-1");
		expect(result).toEqual([
			{ id: "state-1", name: "Todo" },
			{ id: "state-2", name: "In Progress" },
		]);
	});

	test("maps state id and name only", async () => {
		mockGetTeamStates.mockResolvedValue([
			{ id: "s1", name: "Done", color: "#22c55e", type: "completed", position: 3 },
		]);
		const adapter = new LinearAdapter();
		const [state] = await adapter.getAvailableStates({ teamId: "team-x" });
		expect(state).toEqual({ id: "s1", name: "Done" });
	});
});

describe("LinearAdapter.getIssueDetail", () => {
	test("maps description and comments", async () => {
		mockGetIssueDetail.mockResolvedValue({
			description: "Fix the login bug",
			comments: [
				{
					id: "comment-1",
					author: "Alice",
					avatarUrl: "https://example.com/alice.png",
					body: "LGTM",
					createdAt: "2026-04-01T10:00:00Z",
				},
			],
		});
		const adapter = new LinearAdapter();
		const detail = await adapter.getIssueDetail("issue-1");
		expect(detail.description).toBe("Fix the login bug");
		expect(detail.comments).toHaveLength(1);
		expect(detail.comments[0]).toEqual({
			id: "comment-1",
			author: "Alice",
			avatarUrl: "https://example.com/alice.png",
			body: "LGTM",
			createdAt: "2026-04-01T10:00:00Z",
		});
	});

	test("handles null comments array gracefully", async () => {
		mockGetIssueDetail.mockResolvedValue({
			description: "Some issue",
			comments: null as unknown as [],
		});
		const adapter = new LinearAdapter();
		const detail = await adapter.getIssueDetail("issue-1");
		expect(detail.comments).toEqual([]);
	});

	test("handles null description", async () => {
		mockGetIssueDetail.mockResolvedValue({
			description: null as unknown as string,
			comments: [],
		});
		const adapter = new LinearAdapter();
		const detail = await adapter.getIssueDetail("issue-1");
		expect(detail.description).toBe("");
	});

	test("uses 'Unknown' fallback for null comment author", async () => {
		mockGetIssueDetail.mockResolvedValue({
			description: "",
			comments: [
				{
					id: "c1",
					author: null as unknown as string,
					avatarUrl: undefined,
					body: "Hello",
					createdAt: "2026-04-01T00:00:00Z",
				},
			],
		});
		const adapter = new LinearAdapter();
		const detail = await adapter.getIssueDetail("issue-1");
		expect(detail.comments[0]?.author).toBe("Unknown");
	});

	test("avatarUrl is undefined when null", async () => {
		mockGetIssueDetail.mockResolvedValue({
			description: "",
			comments: [
				{
					id: "c1",
					author: "Bob",
					avatarUrl: null,
					body: "Hello",
					createdAt: "2026-04-01T00:00:00Z",
				},
			],
		});
		const adapter = new LinearAdapter();
		const detail = await adapter.getIssueDetail("issue-1");
		expect(detail.comments[0]?.avatarUrl).toBeUndefined();
	});
});

describe("LinearAdapter.updateIssueState", () => {
	test("delegates to updateIssueState", async () => {
		mockUpdateIssueState.mockResolvedValue(undefined);
		const adapter = new LinearAdapter();
		await adapter.updateIssueState("issue-1", "state-done");
		expect(mockUpdateIssueState).toHaveBeenCalledWith("issue-1", "state-done");
	});
});
