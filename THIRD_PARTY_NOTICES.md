# Third-Party Notices

This product bundles vendored copies of third-party open-source software. Their
source is committed under `vendor/` at pinned commits; build artifacts
(`node_modules/`, built client assets) are generated and git-ignored.

---

## Claude-Code-Agent-Monitor

- **Upstream:** https://github.com/hoangsonww/Claude-Code-Agent-Monitor
- **Pinned commit:** `840c518d7fa69231de049e41b893938228b67e40`
- **Vendored at:** `vendor/agent-monitor/`
- **Usage:** Bundled and run as a local `127.0.0.1` sidecar process by the
  desktop app (the embedded "Claude Dashboard" tab). Carries local patches —
  see `vendor/agent-monitor/VENDOR.md` (patch ledger).
- **License:** MIT — © 2026 Son Nguyen. Full text in
  `vendor/agent-monitor/LICENSE`.

Bundled runtime dependencies (root, pure JS — no native addons shipped):
`express`, `ws`, `cors`, `multer`, `swagger-ui-express`, `tar`, `uuid`,
`web-push`, `adm-zip`, and their transitive dependencies (licenses in the
bundled `vendor/agent-monitor/node_modules/`). The optional native dependency
`better-sqlite3` is **deliberately not shipped**; the server uses Node's
built-in `node:sqlite` instead. The React/Vite client is built to static assets
(`vendor/agent-monitor/client/dist/`).

```
MIT License

Copyright (c) 2026 Son Nguyen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
