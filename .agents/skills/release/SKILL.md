---
name: releasing
description: Use when creating a new release — bumps version, generates changelog from merged PRs, writes user-facing release notes, updates Linear tickets, tags and pushes
---

# Releasing

Orchestrate a full release: version bump, changelog, Linear ticket updates, tag, push.

## Process

When the user invokes `/release`, follow these steps in order. Use Bash, Read, Edit, and Write tools — do not ask the user to run commands manually.

### 1. Read current state

```bash
# Get current version
node -p "require('./apps/desktop/package.json').version"

# Get last tag
git describe --tags --abbrev=0

# Verify on main branch
git branch --show-current
```

If not on `main`, warn the user and ask to confirm before proceeding.

### 2. Ask release type

Present the options with calculated next versions:

```
Current version: {current}

Release type:
  patch → {current with patch bumped} (bug fixes)
  minor → {current with minor bumped} (new features)
  major → {current with major bumped} (breaking changes)
```

Wait for user response.

### 3. Extract changes since last tag

```bash
# Get merged PR numbers and branch names since last tag
gh pr list --state merged --search "merged:>=$(git log -1 --format=%ci {last-tag})" --json number,title,headRefName --limit 100
```

If no PRs found, also try:

```bash
# Fallback: get merge commits since last tag
git log {last-tag}..HEAD --merges --oneline
```

If still no changes found, abort: "No changes found since {last-tag}. Nothing to release."

### 4. Parse Linear ticket IDs

From each PR's `headRefName` (branch name), extract `SUP-\d+` patterns. Build a mapping of ticket ID → PR(s).

### 5. Generate changelog content

**Developer changelog ("Changes" section):**
List every PR. Format:
- PRs with a Linear ticket: `- **SUP-42**: {PR title} (#{PR number})`
- PRs without a ticket: `- {PR title} (#{PR number})`

**User-facing release notes ("What's New" section):**
Write 2-5 sentences summarizing what changed from a user's perspective. Rules:
- Focus on features and improvements users will notice
- No ticket IDs, PR numbers, or internal jargon
- No CI/build/dependency changes
- Group naturally: new features first, improvements second, notable fixes third
- Use the app name "SuperiorSwarm"
- If there are only internal/CI changes, write: "Bug fixes and performance improvements."

### 6. Append to CHANGELOG.md

Read the existing `CHANGELOG.md`. Insert the new version block after the `# Changelog` heading (before previous versions):

```markdown
## v{version} ({YYYY-MM-DD})

### What's New
{user-facing release notes}

### Changes
{developer changelog}
```

Also write the "What's New" content to a temporary `.release-notes.md` file (used later to update the GitHub Release body).

### 7. Update Linear tickets

**Skip this entire section if `LINEAR_API_KEY` is not set.** Warn: "LINEAR_API_KEY not set — skipping Linear ticket updates."

For each extracted `SUP-{id}`:

**a) Find the issue:**
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LINEAR_API_KEY" \
  -d '{"query": "{ issueSearch(filter: { identifier: { eq: \"SUP-{id}\" } }) { nodes { id identifier title state { name type } team { id } } } }"}'
```

If not found, warn and skip this ticket.

**b) Get the "Done" workflow state for the team:**
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LINEAR_API_KEY" \
  -d '{"query": "{ workflowStates(filter: { team: { id: { eq: \"{team-id}\" } }, type: { eq: \"completed\" } }) { nodes { id name } } }"}'
```

Pick the first completed-type state.

**c) Update status to Done (if not already completed):**
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LINEAR_API_KEY" \
  -d '{"query": "mutation { issueUpdate(id: \"{issue-id}\", input: { stateId: \"{done-state-id}\" }) { success } }"}'
```

**d) Add release comment:**
```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LINEAR_API_KEY" \
  -d '{"query": "mutation { commentCreate(input: { issueId: \"{issue-id}\", body: \"Released in v{version}\" }) { success } }"}'
```

Report results: "Updated SUP-42: moved to Done, commented 'Released in v{version}'"

If any Linear API call fails, warn and continue with the next ticket. Do not abort the release.

### 8. Bump version

Edit `apps/desktop/package.json` — change the `"version"` field to the new version.

### 9. Commit, tag, push

```bash
git add apps/desktop/package.json CHANGELOG.md
git commit -m "release: v{version}"
git tag v{version}
git push origin main
git push origin v{version}
```

**Important:** Push the tag separately — `--follow-tags` only pushes annotated tags, and `git tag` creates lightweight tags.

If push fails, abort and tell the user to resolve manually. Do not delete the tag or reset.

### 10. Update GitHub Release

Wait for the GitHub Actions workflow to create the draft release. This typically takes **10–15 minutes**. Run the poll in the background so the user isn't blocked:

```bash
# Poll until release exists (max 20 minutes), run in background
for i in {1..120}; do
  result=$(gh release view v{version} --json isDraft 2>/dev/null)
  if [ -n "$result" ]; then
    echo "Release found! Updating body..."
    gh release edit v{version} --notes-file .release-notes.md && rm .release-notes.md && echo "Done — release notes updated."
    break
  fi
  echo "Attempt $i: not ready yet, waiting 10s..."
  sleep 10
done
```

Then update the release body with the user-facing notes:

```bash
gh release edit v{version} --notes-file .release-notes.md
```

Clean up:
```bash
rm .release-notes.md
```

### 11. Done

Output:

```
Release v{version} complete!

  Changelog: updated CHANGELOG.md
  Linear: {N} tickets marked as Done
  GitHub: draft release ready for review

  → https://github.com/{owner}/{repo}/releases/tag/v{version}

  Review the draft and click "Publish" when ready.
```

## Error Handling

- **Not on main branch** → warn and ask to confirm
- **No changes since last tag** → abort
- **LINEAR_API_KEY not set** → skip Linear updates, warn, continue
- **Linear API errors** → warn per-ticket, continue
- **Git push fails** → abort, do not clean up partial state
- **Version tag already exists** → abort with message
- **GitHub Release not created after 20 min** → warn, output manual URL, continue
