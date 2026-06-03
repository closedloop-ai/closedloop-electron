# Third-Party Notices

This product bundles third-party open-source software pinned in
`apps/desktop/package.json`.

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
