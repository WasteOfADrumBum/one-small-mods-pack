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
| Owner authorization | actor must be the repository owner, plus an exact phrase, plus the `npm-publish` / `github-pages` environment reviewer |

Any gate that cannot be evaluated fails the run. The default modes (`dry-run`, `build`) upload nothing.

## One-time setup (owner)

1. **npm account**: sign in at <https://www.npmjs.com/>, turn on 2FA, and confirm the name is still
   free: `npm view one-small-modspack` must say E404. A 404 does not reserve the name.
2. **GitHub environment `npm-publish`**: Settings > Environments > New environment. Add yourself as a
   required reviewer and restrict deployment branches to `main`.
3. **First publication only**: npm trusted publishing can be configured only for a package that exists.
   For the first release create a granular access token at
   <https://www.npmjs.com/settings/~/tokens> (packages: read and write, all packages or the new
   name, expiry 1–7 days), and store it as the `NPM_TOKEN` secret of the `npm-publish` environment
   (not a repository secret).
4. **After the first publication**: on the package's npm Settings page add a trusted publisher
   (GitHub Actions, repository `WasteOfADrumBum/one-small-mods-pack`, workflow `release.yml`,
   environment `npm-publish`), then delete the `NPM_TOKEN` secret and revoke the token.
5. **Website**: Settings > Pages > Source: GitHub Actions. Add yourself as required reviewer on the
   `github-pages` environment. The site uses relative links, so it works at
   `https://wasteofadrumbum.github.io/one-small-mods-pack/`.

## Release steps

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
6. GitHub release (owner): `gh release create v2.0.0 --verify-tag --title "One Small ModsPack 2.0.0"
   --notes-file release/2.0.0/release-notes.md`, and attach the tarball and `SHA256SUMS` from the
   run's artifact.
7. Website: Actions > Website (GitHub Pages), mode `deploy`, authorization
   `I authorize deploying the ModsPack website from <sha>`, approve `github-pages`.
8. Check: `npm view one-small-modspack@2.0.0 dist.integrity`, `npx one-small-modspack@2.0.0 --version`
   in an empty folder, the provenance badge on npmjs.com, and the Pages URL.

## Rollback

- **npm, bad release**: `npm deprecate one-small-modspack@2.0.0 "<reason>; use <good version>"`, then
  publish a fixed patch version. `npm unpublish one-small-modspack@2.0.0` is possible only within
  72 hours and only while no other package depends on it, and a version number can never be reused.
- **Website**: rerun the Pages workflow with `deploy` on the previous good commit.
- **Tag or GitHub release made by mistake**: `gh release delete v2.0.0`, then
  `git push --delete origin v2.0.0` (before anything was published from it).
- **A consuming project**: `npx modspack uninstall --yes` removes what `init` installed and nothing else.
