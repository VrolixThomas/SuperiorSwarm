// OAuth credentials injected at build time via environment variables.
// Set these in .env (gitignored) or your CI/CD environment.
// See .env.example for the required variables.
export const JIRA_CLIENT_ID = process.env["JIRA_CLIENT_ID"] ?? "";
export const JIRA_CLIENT_SECRET = process.env["JIRA_CLIENT_SECRET"] ?? "";

export const BITBUCKET_CLIENT_ID = process.env["BITBUCKET_CLIENT_ID"] ?? "";
export const BITBUCKET_CLIENT_SECRET = process.env["BITBUCKET_CLIENT_SECRET"] ?? "";

export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_URL } from "../oauth-constants";

export const JIRA_AUTH_URL = "https://auth.atlassian.com/authorize";
export const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const JIRA_ACCESSIBLE_RESOURCES_URL =
	"https://api.atlassian.com/oauth/token/accessible-resources";

export const BITBUCKET_AUTH_URL = "https://bitbucket.org/site/oauth2/authorize";
export const BITBUCKET_TOKEN_URL = "https://bitbucket.org/site/oauth2/access_token";
export const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

// The board/sprint scopes are required by Jira Software's Agile REST endpoints.
// Keep the classic Jira scopes for the platform endpoints used elsewhere.
const JIRA_BASE_SCOPES = ["read:jira-work", "read:jira-user", "offline_access"];
const JIRA_AGILE_SCOPES = [
	"read:board-scope:jira-software",
	"read:board-scope.admin:jira-software",
	"read:sprint:jira-software",
	"read:issue-details:jira",
	"read:project:jira",
	"read:jql:jira",
	"write:issue:jira",
];

export const JIRA_SCOPES = [...JIRA_BASE_SCOPES, ...JIRA_AGILE_SCOPES].join(" ");
