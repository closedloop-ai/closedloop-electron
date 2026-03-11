# ClosedLoop Electron - Development Notes

## Testing the Local Gateway (HTTP API)

The desktop Electron app runs a localhost HTTP gateway. To test it manually:

### Authentication

Engineer routes (`/api/engineer/*`) require auth. The gateway token is a random 24-byte hex generated in-memory at startup — you cannot extract it externally. However, **loopback requests with a localhost Origin header bypass token auth**:

```bash
curl -s -H "Origin: http://localhost" "http://localhost:<PORT>/api/engineer/..."
```

The health endpoint is unauthenticated:
```bash
curl -s http://localhost:<PORT>/health
```

The gateway port is visible in the health response or the Electron UI. Typical dev port: `19432`.

### Sandbox Directory Enforcement

Every API route checks target paths against the sandbox base directory via `isPathAllowed()` in `src/server/security.ts`. Paths outside the sandbox return HTTP 403 `{"error": "directory not allowed"}`.

The `sandboxBaseDirectory` is the single source of truth for path access. It is stored in `electron-store` via `SettingsStore` and used to derive a single-entry allowlist at runtime via `buildAllowedDirectories()` in `src/shared/sandbox-policy.ts`.

Hardcoded sensitive paths (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/Library/Keychains`, `/etc`, `/bin`, `/sbin`) are always denied, even if a parent is allowed.

### Example Test Commands

```bash
# Should succeed (if /Users/<you>/Source is the sandbox base directory)
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/engineer/directories?path=/Users/<you>/Source"

# Should fail — outside sandbox
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/engineer/directories?path=/tmp"

# Should fail — sensitive deny list
curl -s -H "Origin: http://localhost" "http://localhost:19432/api/engineer/directories?path=/Users/<you>/.ssh"
```
