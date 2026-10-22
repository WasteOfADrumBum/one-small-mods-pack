# Continuous integration

`modspack init --ci` writes `.github/workflows/modspack.yml`. The core of it is:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- run: npx --no-install modspack release-check --write
```

Use `--advisory` while you introduce it: the job reports but does not fail, except when a required check could not run (exit 3).

Hooks inside AI tools can be bypassed or fail open. The CI job is the enforced backstop.
