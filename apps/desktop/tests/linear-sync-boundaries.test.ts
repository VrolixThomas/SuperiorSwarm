import { beforeEach, describe, expect, mock, test } from "bun:test";

type LinearRequest = { query: string; variables?: Record<string, unknown> };

const requests: LinearRequest[] = [];
const mockLinearFetch = mock(async ({ query, variables }: LinearRequest) => {
	requests.push({ query, variables });
	if (query.includes("query Teams")) {
		const after = variables?.after;
		return Response.json({
			data: {
				teams:
					after === null
						? {
								nodes: [{ id: "team-1", name: "First", key: "ONE" }],
								pageInfo: { hasNextPage: true, endCursor: "page-2" },
							}
						: {
								nodes: [{ id: "team-2", name: "Second", key: "TWO" }],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
			},
		});
	}

	return Response.json({
		data: {
			issues: {
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	});
});

mock.module("../src/main/linear/auth", () => ({ linearFetch: mockLinearFetch }));

const { getTeams, getTeamIssuesWithDone } = await import("../src/main/linear/linear");

beforeEach(() => {
	requests.length = 0;
	mockLinearFetch.mockClear();
});

describe("Linear sync boundaries", () => {
	test("paginates the complete team connection", async () => {
		const teams = await getTeams();

		expect(teams.map((team) => team.id)).toEqual(["team-1", "team-2"]);
		expect(requests.map((request) => request.variables?.after)).toEqual([null, "page-2"]);
	});

	test("declares filtered issue team variables as GraphQL ID", async () => {
		await getTeamIssuesWithDone("team-1");

		const issueQueries = requests.filter((request) => request.query.includes("TeamIssues"));
		expect(issueQueries).toHaveLength(3);
		for (const request of issueQueries) {
			expect(request.query).toContain("$teamId: ID!");
			expect(request.query).not.toContain("$teamId: String");
			expect(request.variables?.teamId).toBe("team-1");
		}
	});
});
