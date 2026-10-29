---
name: nextjs-release-audit
description: Checks a Next.js app for release problems the generic gates miss - security headers, production browser source maps, NEXT_PUBLIC secrets, server action and route handler authorization, middleware matchers, image remote patterns, caching of personalised data, and build output size. Use before releasing a Next.js application.
license: MIT
compatibility: For Next.js 13.4+ (App Router or Pages Router).
metadata:
  modspack-category: release
  modspack-agent: release-engineer
---

# Next.js release audit

Framework-specific release checks for Next.js, on top of `modspack release-check`.

## When to use

- Before deploying a Next.js app to production.
- After upgrading Next.js major versions.

## Prerequisites

- `next` in the project's dependencies; the project builds with `next build`.

## Inputs

- `next.config.*`, `middleware.*`, `app/` or `pages/`, and the deployment target (Vercel, self-hosted, static export).

## Steps

1. Run `npx modspack release-check` first; this skill adds to it.
2. Build: `next build`. Record route sizes and any warnings.
3. Work through [the Next.js checklist](references/checklist.md).
4. Classify each item PASS, FINDING or N/A with file and line.

## Outputs

The checklist with status per item, findings with fixes, and the build summary.

## Verification

- `next build` ran in this session and its output is quoted.

## Safety

- Read-only. Never deploy or change Vercel project settings.

## Limitations

- Platform settings (Vercel headers, environment variables, protection) are NOT ASSESSED unless provided.
