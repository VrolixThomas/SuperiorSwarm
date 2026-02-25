// OAuth credentials injected at build time via environment variables.
// Set these in .env (gitignored) or your CI/CD environment.
// See .env.example for the required variables.
export const JIRA_CLIENT_ID = process.env.JIRA_CLIENT_ID ?? "";
export const JIRA_CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET ?? "";

export const BITBUCKET_CLIENT_ID = process.env.BITBUCKET_CLIENT_ID ?? "";
export const BITBUCKET_CLIENT_SECRET = process.env.BITBUCKET_CLIENT_SECRET ?? "";

export const OAUTH_CALLBACK_PORT = 27391;
export const OAUTH_CALLBACK_URL = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;

export const JIRA_AUTH_URL = "https://auth.atlassian.com/authorize";
export const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const JIRA_ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";

export const BITBUCKET_AUTH_URL = "https://bitbucket.org/site/oauth2/authorize";
export const BITBUCKET_TOKEN_URL = "https://bitbucket.org/site/oauth2/access_token";
export const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

export const JIRA_SCOPES = "read:jira-work read:jira-user offline_access";
