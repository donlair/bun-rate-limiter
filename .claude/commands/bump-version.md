---
description: Bump package version and create release PR via Changesets workflow
args:
  - name: version_type
    description: "Release type: patch, minor, or major"
    required: true
  - name: summary
    description: "Brief description of what changed in this release"
    required: true
---

# Version Bump Automation

You are initiating a version bump with:
- **Version type**: $ARGUMENTS.version_type
- **Summary**: $ARGUMENTS.summary

## Execute the following steps automatically (do not ask for confirmation):

### Step 1: Verify Prerequisites
1. Check that working directory is clean (no uncommitted changes):
   ```bash
   git status --porcelain
   ```
   If output is not empty, stop and display error: "Working directory has uncommitted changes. Please commit or stash them first."

2. Ensure we're on the main branch:
   ```bash
   git branch --show-current
   ```
   If output is not "main", stop and display error: "Must be on main branch. Currently on: {current_branch}"

3. Pull latest changes from origin:
   ```bash
   git pull origin main
   ```

### Step 2: Calculate Version
1. Read current version from package.json
2. Calculate new version based on $ARGUMENTS.version_type:
   - **patch**: increment patch (e.g., 0.2.0 → 0.2.1)
   - **minor**: increment minor, reset patch (e.g., 0.2.0 → 0.3.0)
   - **major**: increment major, reset minor and patch (e.g., 0.2.0 → 1.0.0)

3. Validate version_type is one of: patch, minor, major
   If invalid, stop and display error: "Invalid version_type. Must be: patch, minor, or major"

### Step 3: Create Release Branch
1. Create and checkout branch: `release/v{new_version}`
   ```bash
   git checkout -b release/v{new_version}
   ```

### Step 4: Create Changeset File
1. Generate a random changeset ID using 8 lowercase letters (e.g., "happy-pandas-jump", "brave-lions-dance")

2. Create `.changeset/{changeset-id}.md` with this exact format:

```markdown
---
"bun-rate-limiter": {version_type}
---

{summary}
```

**Important formatting rules:**
- Replace `{version_type}` with the literal value: patch, minor, or major (NOT "patch", no quotes)
- Replace `{summary}` with $ARGUMENTS.summary
- The package name must be exactly "bun-rate-limiter" (from package.json)
- Include the blank line between frontmatter and summary

### Step 5: Commit and Push
1. Stage the changeset file:
   ```bash
   git add .changeset/
   ```

2. Commit with message:
   ```bash
   git commit -m "chore: add changeset for v{new_version} release"
   ```

3. Push the branch:
   ```bash
   git push -u origin release/v{new_version}
   ```

### Step 6: Create Pull Request
1. Use GitHub CLI to create PR:
   ```bash
   gh pr create --title "Release v{new_version}" --body "## Release Summary

{summary}

---

This PR adds a changeset for the v{new_version} release.

**What happens next:**
1. Merge this PR to main
2. GitHub Actions will automatically create a 'Version Packages' PR
3. That PR will bump package.json version to {new_version} and update CHANGELOG.md
4. Merge the 'Version Packages' PR to publish to npm via OIDC

**No npm tokens needed** - publishing happens automatically via trusted publishing!"
   ```

### Step 7: Display Next Steps
After creating the PR successfully, display:

```
✅ Version bump PR created successfully!

📦 Version: {current_version} → {new_version}
🔖 Type: {version_type}
📝 Summary: {summary}

## Next Steps:
1. Review and merge the PR to main
2. Wait for Changesets GitHub Action to create a "Version Packages" PR
3. Review that PR (it will update package.json and CHANGELOG.md)
4. Merge the "Version Packages" PR to automatically publish to npm

The package will be published via OIDC - no npm tokens needed!
```

## Important Notes
- Do NOT run `bun run changeset` interactively - create the file directly
- Use the exact changeset file format shown above
- The package name must be exactly "bun-rate-limiter" (from package.json)
- Ensure the version_type in the changeset frontmatter is NOT quoted
- This command creates a PR but does not publish directly - publishing happens after merging the Version Packages PR

## Error Handling
If any step fails:
1. Display clear error message explaining what went wrong
2. Show the command that failed
3. Provide guidance on how to fix it
4. If a branch was created, suggest: `git checkout main && git branch -D release/v{new_version}` to clean up
