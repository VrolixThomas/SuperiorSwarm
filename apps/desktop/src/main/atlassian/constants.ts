// OAuth credentials — embedded in app binary.
// These are scoped to user-authorized tokens only.
export const JIRA_CLIENT_ID = "PLACEHOLDER_JIRA_CLIENT_ID";
export const JIRA_CLIENT_SECRET = "PLACEHOLDER_JIRA_CLIENT_SECRET";

export const BITBUCKET_CLIENT_ID = "PLACEHOLDER_BITBUCKET_CLIENT_ID";
export const BITBUCKET_CLIENT_SECRET = "PLACEHOLDER_BITBUCKET_CLIENT_SECRET";

export const OAUTH_CALLBACK_PORT = 27391;
export const OAUTH_CALLBACK_URL = `http://localhost:${OAUTH_CALLBACK_PORT}/callback`;

export const JIRA_AUTH_URL = "https://auth.atlassian.com/authorize";
export const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const JIRA_ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";

export const BITBUCKET_AUTH_URL = "https://bitbucket.org/site/oauth2/authorize";
export const BITBUCKET_TOKEN_URL = "https://bitbucket.org/site/oauth2/access_token";
export const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

export const JIRA_SCOPES = "read:jira-work read:jira-user offline_access";
