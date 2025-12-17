# Contributing / Releases

This repo uses Changesets to keep git history, npm versions, and GitHub releases aligned.

## Adding a changeset

For any user-facing change:

```bash
bun run changeset
```

Commit the generated `.changeset/*.md` file with your PR.

## Releasing

1. Merge PRs into `main` (with changesets).
2. GitHub Actions opens/updates a “Version Packages” PR.
3. Merge the release PR to bump `package.json` and publish to npm.

### Required secrets

- npm Trusted Publishing (OIDC) configured for this GitHub repo (no `NPM_TOKEN` required)
