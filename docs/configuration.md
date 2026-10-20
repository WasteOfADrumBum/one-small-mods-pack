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
