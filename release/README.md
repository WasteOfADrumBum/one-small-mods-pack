# Releasing one-small-modspack

Maintainer runbook. Nothing in `release/` ships in the npm package (`release/package-files.txt`
is the exact list that does). Publishing to npm, tagging, creating the GitHub release and
deploying the website are owner actions; the workflows below only make them safe and repeatable.

## What guards a release

| Gate | Where it is enforced |
|---|---|
| Candidate is a specific commit on `main` | `release.yml` and `pages.yml` (`candidate_sha` input, ancestry check) |
| Required CI passed on that commit (cli, mods, windows, site, node-compat on Node 20/24 and macOS) | `release.yml` reads the commit's check runs |
| Version agrees: `package.json`, `CHANGELOG.md` heading, any existing `v<version>` tag | `release.yml`; plugin versions and changelog also by `test/release-docs.test.mjs` |
| Not already on npm | `release.yml` (`npm view`) |
| Tests, typecheck, shared files, dependency audit | `release.yml` reruns them on the candidate |
| Tarball holds exactly the expected files | `release.yml` compares with `release/package-files.txt`; `test/package.test.mjs` keeps that list current |
| The packed artifact installs and works | `scripts/consumer-smoke.mjs` on the exact tarball |
| Manual acceptance recorded by a person | `release/2.0.0/manual-acceptance.md`: no `PENDING`/`FAIL` row, and an `Owner sign-off:` line |
| Owner authorization | actor must be the repository owner, plus an exact phrase, plus the `npm-publish` environment reviewer |

Any gate that cannot be evaluated fails the run. The default modes (`dry-run`, `build`) upload nothing.

## One-time setup (owner)

1. **npm account**: sign in at <https://www.npmjs.com/>, turn on 2FA, and confirm the name is still
   free: `npm view one-small-modspack` must say E404. A 404 does not reserve the name.
2. **GitHub environment `npm-publish`**: Settings > Environments > New environment. Add yourself as a
   required reviewer and restrict deployment branches to `main`.
3. **First publication only**: npm can trust a publisher only for a package that already exists,
   so 2.0.0 is published with a short-lived token. Create a granular access token at
   <https://www.npmjs.com/settings/~/tokens>: permissions **Read and write**, packages **All
   packages** (an unpublished name cannot be selected), **Bypass two-factor authentication**
   checked (CI cannot answer a 2FA prompt), expiry 1 day. Store it as the `NPM_TOKEN` secret of the
   `npm-publish` environment (not a repository secret). The release still carries provenance:
   `--provenance` signs with the workflow's GitHub OIDC identity, whatever authenticates the upload.
4. **After the first publication**: on the package's npm Settings page add a trusted publisher
   (GitHub Actions, organization or user `WasteOfADrumBum`, repository `one-small-mods-pack`,
   workflow filename `release.yml`, environment `npm-publish`), or from a terminal with npm 11.15.0 or later:
   `npm trust github one-small-modspack --repo WasteOfADrumBum/one-small-mods-pack --file release.yml --env npm-publish --allow-publish`.
   Then delete the `NPM_TOKEN` secret and revoke the token. npm expires a new trusted-publisher
   configuration that has no successful publish within 2 days, so add it when you are ready to
   release the next version, or re-add it then.
5. **Website**: hosted on Vercel (project `one-small-mods-pack`, settings in `vercel.json`).
   Vercel builds `npm run site` and serves `site/dist` on every merge to `main`.

## 2.0.0 publish outcome (2026-11-11)

`one-small-modspack@2.0.0` is the `latest` version on npm. Provenance for that version cites
Release (npm) run [42989562213](https://github.com/WasteOfADrumBum/one-small-mods-pack/actions/runs/42989562213)
attempt 3, workflow `.github/workflows/release.yml` on `main`, commit `03ab44a`. That run is still
red. The upload succeeded (`+ one-small-modspack@2.0.0`); the next step, "Confirm the registry
serves it", then looped for about 60 seconds and exited 1. The registry recorded `2.0.0` at
2026-11-11T10:35:01Z, about three minutes after the upload. `main` already contains the correction
(commit `6926801`, pull request #11): wait five minutes, then warn instead of failing a publish
npm has accepted. Do not dispatch `publish` for `2.0.0` again. The verify job refuses a version
that is already on npm.

The same run's earlier attempts failed on credentials, which only the owner can fix:

1. Attempt 1: `NODE_AUTH_TOKEN` was empty and npm returned `ENEEDAUTH`.
2. Attempt 2: a token was present, provenance was signed, then npm returned `EOTP` and a browser
   one-time-password URL. Actions cannot complete that prompt. A granular token used from this
   workflow has to be created with bypass two-factor authentication, or publishing has to use a
   trusted publisher instead of a token.
3. Attempt 3 used a token that npm accepted.

Before the next version, add a trusted publisher on the package (GitHub Actions, user
`WasteOfADrumBum`, repository `one-small-mods-pack`, workflow filename `release.yml`, environment
`npm-publish`, allow `npm publish`). Then delete the `NPM_TOKEN` secret on the `npm-publish`
environment and revoke the token. The first-publication token in the setup above was a one-day
token. npm's current notice is that bypass-2FA granular tokens lose direct publish in the change
targeted for January 2027; trusted publishing (or staged publishing plus a maintainer's 2FA
approval) is the path after that. This session cannot see repository secrets, so it does not know
whether that publisher or secret is already set.

The registry also lists `0.0.0-stage`, described as a temporary placeholder for staged publishing.
`latest` is `2.0.0`.

## Release steps

These steps are how 2.0.0 was released. For a later version, use the same gates with that version
and complete the trusted-publisher setup above first.

1. Pick the candidate commit (see `release/2.0.0/tracker.md`) and check CI is green on it.
2. Do the manual checks in `release/2.0.0/manual-acceptance.md`, fill in results and the sign-off
   line, and merge that change. The commit that holds your sign-off is the one you release: it
   changes nothing in the package (`release/` is not shipped).
3. Dry run: Actions > Release (npm) > Run workflow, `candidate_sha` = that commit, `version` = 2.0.0,
   mode `dry-run`. It must end green; the `npm-tarball` artifact holds the tarball and `SHA256SUMS`.
4. Tag (owner):
   `git tag -s v2.0.0 <sha> -m "One Small ModsPack 2.0.0" && git push origin v2.0.0`
   (`-a` instead of `-s` if you do not sign tags).
5. Publish: run the workflow again with mode `publish` and the authorization
   `I authorize publishing one-small-modspack@2.0.0 from <sha>`, then approve the `npm-publish`
   environment when GitHub asks.
   The last step waits up to five minutes for the registry, then warns instead of failing:
   check `npm view one-small-modspack@<version> version` a few minutes later, and if npm staged
   the upload, approve it at npmjs.com > Packages > Staged Packages with 2FA. (2.0.0 took about
   three minutes to appear on 2026-11-11.)
6. GitHub release (owner): `gh release create v2.0.0 --verify-tag --title "One Small ModsPack 2.0.0"
   --notes-file release/2.0.0/release-notes.md`, and attach the tarball and `SHA256SUMS` from the
   run's artifact.
7. Website: nothing to run. Vercel deploys `main` after each merge; check the production URL.
8. Check: `npm view one-small-modspack@2.0.0 dist.integrity`, `npx one-small-modspack@2.0.0 --version`
   in an empty folder, the provenance badge on npmjs.com, and the Vercel production URL.

## Rollback

- **npm, bad release**: `npm deprecate one-small-modspack@2.0.0 "<reason>; use <good version>"`, then
  publish a fixed patch version. `npm unpublish one-small-modspack@2.0.0` is possible only within
  72 hours and only while no other package depends on it, and a version number can never be reused.
- **Website**: rerun the Pages workflow with `deploy` on the previous good commit.
- **Tag or GitHub release made by mistake**: `gh release delete v2.0.0`, then
  `git push --delete origin v2.0.0` (before anything was published from it).
- **A consuming project**: `npx modspack uninstall --yes` removes what `init` installed and nothing else.
