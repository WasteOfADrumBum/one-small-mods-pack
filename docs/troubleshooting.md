# Troubleshooting

- **A required check is BLOCKED.** The script or tool it needs is missing. Add the script to `package.json`, install the dependency, or map it in `quality.scripts`. It is never silently passed.
- **A finding is a false positive.** Add its fingerprint to `security.accepted` with a reason.
- **`init` says a file is not managed.** It exists and was not written by ModsPack, so it is left alone. Move it or pass a different `--platform`.
- **Hooks do not run.** Codex needs project hooks trusted; Copilot and Gemini read their own settings folders. Run `modspack doctor`. Hook runtime on these tools is NOT TESTED in this release.
- **The hook did not stop a shell command.** By design: a command's effect is not knowable from its text. Run `modspack security` in CI.
- **`npx` tries to download the package.** Hooks use `npx --no-install`. Install the package as a dev dependency.
