# Configuration

Put `modspack.config.json` in the project root. Every key is optional. The JSON Schema is `schema/modspack.schema.json`; add `"$schema": "./node_modules/one-small-modspack/schema/modspack.schema.json"` for editor help.

```json
{
  "mode": "enforce",
  "quality": { "required": ["typecheck", "test", "build"] },
  "security": { "failOn": "high", "history": { "maxCommits": 200 } },
  "privacy": { "hipaa": "auto", "publicContacts": ["support@example.com"] },
  "release": { "requiredGates": ["quality", "security", "privacy", "accessibility", "package"] }
}
```

## Dismissing a finding

Findings carry a fingerprint. Add it to `security.accepted` with a reason. An accepted risk also needs `approvedBy`. A dismissed finding keeps its severity in the report.

## Turning a guard off

`guards.security: false` (and the same for privacy, accessibility, design, quality) skips that check. A gate that is required for release but switched off is reported as BLOCKED, not as a pass.

## Privacy and local-first

Nothing is sent anywhere. The only networked option is `security.dependencyAudit`, which is off by default and sends your dependency list to the package registry.

**Editing `publicContacts`.** privacy-guard lets you add an address or phone number to a top-level `publicContacts` array in its own config file (`.claude/guardrail-mods/privacy-guard.json`, or the file named by `configFile`) even at `blockAt: low`. This applies only when the file parses as JSON and the array sits on its own lines (pretty-printed, not a one-line file), and only to string entries shaped like an email address or phone number. The same value in another field, other kinds of personal or health data, and any other file are still blocked.
