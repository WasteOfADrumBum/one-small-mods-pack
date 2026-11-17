<!-- generated from .engineering/state.json (revision 3); edit state.json through a checkpoint, not this file -->

# one-small-mods-pack: development status

All values are **agent-reported**, not independently verified. Check GitHub before relying on them.

- Milestone: ModsPack after the 2.0.0 npm publish
- Active task: npm-release-failure-nov11: Explain the 2026-11-11 Release (npm) failure
- Branch: `cursor/npm-release-failure-fd13`
- Recorded commit: `065732f` on `main`
- Last checkpoint: 2026-11-17T02:24:38Z by cursor

## Next action

Owner, before the next version: add an npm trusted publisher for release.yml and the npm-publish environment (allow npm publish), then delete that environment NPM_TOKEN and revoke the token. Do not dispatch publish for 2.0.0; it is already on the registry. The red run is the old 60-second confirm step; main already warns after five minutes (6926801).

## Completed

- Investigated the 2026-11-11 Release (npm) run. Attempt 3 uploaded one-small-modspack@2.0.0 with provenance; the confirm step then failed after about 60 seconds. The registry shows 2.0.0 at 2026-11-11T10:35:01Z. main already waits five minutes and warns (6926801). This change does not edit the workflow.
- Attempts 1 and 2 of that run failed on npm auth: empty NODE_AUTH_TOKEN (ENEEDAUTH), then a token that required an interactive one-time password (EOTP).
- Public registry: latest is 2.0.0, with provenance for release.yml at 03ab44a. A 0.0.0-stage placeholder is also listed.
- GitHub main at this checkpoint is 065732f, ahead of the previous record 26b5ccd. No open pull requests. CI and Checkpoint contract succeeded on 065732f.

## In progress

_none recorded_

## Tests (agent-reported)

- `Read Release (npm) job logs for the 2026-11-11 publish run (attempts 1-3) and the public npm registry metadata`: pass at `03ab44a`, 2026-11-17T02:24:38Z
- `validate .engineering/state.json with the hub checkpoint schema`: pass at `065732f`, 2026-11-17T02:24:38Z

## Unverified changes

_none recorded_
