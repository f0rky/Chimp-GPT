# Dependency Security

## Policy

Dependency remediation is reviewed in pull requests. Installation, startup, and scheduled GitHub Actions workflows are read-only: they report vulnerabilities but never modify `package-lock.json`, commit, or push changes.

The GitHub Actions security workflow runs daily at 02:00 UTC and for pushes and pull requests. It installs the lockfile with lifecycle scripts disabled, runs `npm audit --audit-level=high`, writes the severity summary to the workflow summary, and uploads the complete JSON result as an artifact. It has read-only repository permission.

## Commands

```bash
# Review the current advisory report without changing files
npm audit --audit-level=high

# Apply compatible lockfile updates locally, then inspect and test the diff
npm audit fix --package-lock-only --ignore-scripts

# Review the project's legacy interactive helper; it may modify package-lock.json
npm run security:auto
```

`npm run security:auto` is intentionally not run automatically. Use it only in a disposable or reviewable working tree because it can create a lockfile backup and apply dependency updates.

## Remediation workflow

1. Reproduce the report with `npm audit --package-lock-only --ignore-scripts`.
2. Update direct dependency constraints or compatible lockfile resolutions.
3. Inspect the `package.json` and `package-lock.json` diff.
4. Run the relevant tests, lint, formatting checks, and a post-change audit.
5. Open a pull request for review; do not allow CI to commit dependency changes.

## Response expectations

- High and critical findings fail the GitHub Actions audit.
- The workflow artifact retains the detailed report for investigation.
- A dependency update that would require a breaking change needs explicit review and test evidence.
