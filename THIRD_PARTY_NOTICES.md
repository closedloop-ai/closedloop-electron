# Third-Party Notices

This product bundles third-party open-source software pinned in
`apps/desktop/package.json`. Some upstream source is fetched by `pnpm` during
development/build, and the desktop build generates a runtime tree under
`apps/desktop/.generated/agent-monitor/` for packaging.

---

## Claude-Code-Agent-Monitor

- **Upstream:** https://github.com/hoangsonww/Claude-Code-Agent-Monitor
- **Pinned commit:** `840c518d7fa69231de049e41b893938228b67e40`
- **Imported via:** pnpm dependencies `agent-dashboard` and
  `agent-dashboard-client`
- **Usage:** Bundled and run as the default local `127.0.0.1` legacy sidecar
  dashboard. The desktop build applies local host patches while generating
  `apps/desktop/.generated/agent-monitor/`.
- **License:** MIT — © 2026 Son Nguyen.

Bundled runtime dependencies remain pure JS. The generated sidecar runtime uses
Node's built-in `node:sqlite`; `better-sqlite3` is not used by the shipped
server, and the packaged desktop runtime strips the hoisted `better-sqlite3`
module from the staged app tree.

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

---

## CodexBar (parsing reference only — not bundled)

- **Upstream:** https://github.com/steipete/CodexBar
- **Used as:** documentation/algorithm reference for the OpenAI **Codex** CLI
  rollout JSONL format — the cumulative→session token semantics and the
  `turn_context.model` attribution rule (`docs/codex.md`). No CodexBar source
  is bundled. Our own first-party Codex ingestion modules
  (`apps/desktop/src/main/collectors/codex/`) were merely informed by it.
- **License:** MIT — © 2026 Peter Steinberger.

```
MIT License

Copyright (c) 2026 Peter Steinberger

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
