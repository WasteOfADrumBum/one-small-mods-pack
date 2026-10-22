---
name: deployment-check
description: Verifies a release can be deployed - clean production build, CI status, shipped package or bundle contents, environment variables, client-side exposure, caching and headers - without deploying it. Use when asked "is this deployable?", before a production deploy, or to validate release artifacts.
license: MIT
metadata:
  modspack-category: release
  modspack-agent: release-engineer
---

# Deployment check

Prove the artifact that would ship is the right one, and safe, before anyone deploys it.

## When to use

- Before a production deploy or a package publish.
- When CI is green but nobody has looked at what the build produces.

## Prerequisites

- The project's build command, and a clean checkout (or `git stash` of local changes, with the user's agreement).

## Inputs

- Target: npm package, static site, serverless app, container.
- The list of environment variables the target defines, if the user can share names (never values).

## Steps

1. Build from clean with the project's own command (`npm ci && npm run build`, or what CI runs). Record the command, duration and result.
2. Check CI for the release commit: `gh run list --commit <sha>` or the CI page. Red or missing CI is a blocker.
3. Inspect what ships:
   - Package: `npm pack --dry-run` lists files. Look for missing entry points, test fixtures, `.env` files, source maps you did not mean to publish.
   - Site or app: list the build output; `npx modspack security` flags source maps and debug files in public output.
4. Environment: grep the code for `process.env.`, `import.meta.env.` and framework equivalents. Each name must be documented and present in the target. Any secret-looking name with a client prefix (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `PUBLIC_`) is a blocker.
5. Headers and caching: confirm security headers are configured, and that personalised responses are not cached publicly.
6. Rollback: confirm the previous version can be restored (previous deployment, previous package version, database migration down path).

## Outputs

A deployment readiness list: build, CI, contents, environment, headers and caching, rollback, each PASS, FAIL, BLOCKED or NOT ASSESSED with evidence, and the exact deploy or publish commands for the user to run.

## Verification

- The build was run in this session, from a clean state, and its output inspected.
- Every environment variable used is accounted for by name.

## Safety

- Never deploy, publish, push tags or change production settings. A passing build does not authorize a deployment.
- Never print environment variable values.

## Limitations

- Cannot see the production platform's settings unless given access; those items are NOT ASSESSED.
