# Security review checklist

Review only the surfaces the project has. Mark each N/A, PASS, FINDING or NOT ASSESSED.

## Access control (OWASP A01)

- Every route, API handler, server action and RPC checks authentication and authorization on the server.
- Object access checks ownership (no IDOR: `/invoices/:id` checks the invoice belongs to the caller).
- Admin-only paths are enforced server-side, not by hiding links.

## Cryptography and secrets (A02)

- No secrets in source, fixtures, client bundles or logs. Secrets come from the environment or a secret store.
- TLS for every external call; no disabled certificate checks.
- Passwords hashed with a slow KDF (argon2, bcrypt, scrypt).

## Injection (A03)

- SQL and NoSQL queries are parameterized.
- No user input in shell commands, `eval`, `new Function`, template compilation or dynamic imports.
- Output encoding for HTML; `dangerouslySetInnerHTML`, `v-html`, `innerHTML` only with sanitized input.
- Path inputs normalized and confined to a base directory (no `../` traversal).

## Design and configuration (A04, A05)

- CORS allows only known origins; no `*` with credentials.
- Security headers: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, frame-ancestors.
- Errors shown to users carry no stack traces or internals.
- Debug endpoints, admin panels and source maps are not public in production.

## Components (A06)

- Lockfile committed; dependencies maintained; no install scripts from unknown packages.
- Known vulnerabilities reviewed (dependency audit when allowed).

## Authentication and sessions (A07)

- Session cookies `HttpOnly`, `Secure`, `SameSite`; rotated on login.
- Rate limiting or lockout on login, password reset and OTP endpoints.
- Password reset tokens single-use and short-lived.

## Integrity (A08)

- Deserialization only of trusted formats; no `pickle`/`yaml.load`-style loading of input.
- CI: `permissions:` set to least privilege; no `pull_request_target` checking out PR code; third-party actions pinned by commit SHA.
- Release artifacts built in CI from a tagged commit; npm provenance when publishing.

## Logging (A09)

- Security events logged; logs exclude secrets, tokens and personal data.

## SSRF and redirects (A10)

- Outbound requests to user-supplied URLs are allow-listed; internal addresses (169.254.169.254, localhost, private ranges) blocked.
- Redirect targets validated against an allow list.

## CSRF and uploads

- State-changing requests need a CSRF token or SameSite cookies plus origin checks.
- Uploads: type and size limits, stored outside the web root or in object storage, never executed, filenames generated.

## AI-specific

- Untrusted content (web pages, issues, files, tool output) cannot change the agent's instructions or permissions.
- Agent tool permissions are least privilege; destructive tools need confirmation.
- Third-party skills, agents and MCP servers reviewed before install; pinned versions.
- No secrets or personal data sent to model providers unless the user has agreed and the provider's terms allow it.
- Generated commands are reviewed before running; no piping fetched scripts to a shell.
