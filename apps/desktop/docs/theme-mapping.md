# Theme mapping: gateway → web app shadcn tokens

The gateway renderer (`apps/desktop/src/renderer/index.html`) currently defines its
own CSS custom properties (`--bg`, `--panel`, `--ink`, …) and uses raw hex values
throughout. The main web app (`packages/design-system/styles/globals.css`) uses
shadcn semantic tokens in `oklch()`. This document maps the gateway's tokens to
the web app's shadcn tokens so both apps share one palette.

## Strategy

1. Adopt the shadcn token names as the source of truth (`--background`,
   `--foreground`, `--primary`, `--muted-foreground`, …).
2. Keep the legacy gateway names (`--bg`, `--ink`, `--accent`, …) as **aliases**
   that resolve to the shadcn tokens. Existing CSS keeps working unchanged.
3. Replace one-off hex values (`#dc2626`, `#16a34a`, `#d97706`, …) with the
   shadcn semantic colors (`--destructive`, `--success`, `--warning`, …) as the
   CSS gets touched.

## Core mapping (gateway → shadcn)

| Gateway token   | Light example      | Shadcn token            | Notes                                                              |
| --------------- | ------------------ | ----------------------- | ------------------------------------------------------------------ |
| `--bg`          | `#f4f1ea` (cream)  | `--background`          | Page background. Gateway loses the warm-cream tint by design.      |
| `--panel`       | `#fffdf8`          | `--card`                | Header, panel, settings group surfaces.                            |
| `--surface`     | `#ffffff`          | `--card`                | Inputs, status cards, control chips. Same as `--panel`.            |
| `--surface-alt` | `#f8fafc`          | `--muted`               | Radial-gradient stop, subtle backgrounds.                          |
| `--ink`         | `#1f2937`          | `--foreground`          | Primary text.                                                      |
| `--muted`       | `#6b7280`          | `--muted-foreground`    | Secondary text, labels, hints.                                     |
| `--accent`      | `#0f766e` (teal)   | `--primary`             | Brand color. Gateway moves from teal to the web app's indigo.      |
| `--accent-ink`  | `#ffffff`          | `--primary-foreground`  | Text on primary.                                                   |
| `--border`      | `#d6d3d1`          | `--border`              | 1:1.                                                               |
| `--focus`       | `rgba(15,118,110,.28)` | `--ring`            | Focus outline / focus-within shadow.                               |

## Hardcoded hex → shadcn semantic

The renderer scatters status hex values throughout. Replace progressively:

| Hex values                              | Use case                | Shadcn token              |
| --------------------------------------- | ----------------------- | ------------------------- |
| `#dc2626`, `#f87171`                    | Errors, unhealthy, critical | `--destructive`       |
| `#16a34a`, `#4ade80`                    | OK, healthy, success    | `--success`               |
| `#d97706`, `#f59e0b`, `#fbbf24`, `#b45309` | Warnings, pending, missing/invalid CLI | `--warning` |
| `#2563eb`, `#60a5fa`                    | Info, neutral status pills | `--info`               |
| `#7c3aed`, `#8b5cf6`, `#c4b5fd`         | AI / agent runs         | `--ai`                    |
| `#9ca3af`                               | Disabled / null         | `--muted-foreground`      |

For tinted backgrounds (`rgba(220, 38, 38, 0.12)`, etc.), use
`color-mix(in srgb, var(--destructive) 12%, transparent)` — the renderer
already uses `color-mix` in several places, so the pattern carries over.

## What's been applied

The renderer (`apps/desktop/src/renderer/index.html`) now uses shadcn semantic
tokens exclusively. No hex literals, no `rgba(r,g,b,a)` color values, and no
legacy `--bg`/`--panel`/`--surface`/`--surface-alt`/`--ink`/`--focus`/`--accent`/
`--accent-ink`/`--muted` aliases remain in the CSS. The `:root` and dark `@media`
blocks declare the shadcn palette verbatim from `packages/design-system/styles/globals.css`.

Replacements applied:

| From                                        | To                                | Count       |
| ------------------------------------------- | --------------------------------- | ----------- |
| `var(--accent)`                             | `var(--primary)`                  | 47          |
| `var(--accent-ink)`                         | `var(--primary-foreground)`       | 8           |
| `var(--muted)`                              | `var(--muted-foreground)`         | 39          |
| `var(--bg)`                                 | `var(--background)`               | (replaced)  |
| `var(--panel)`                              | `var(--card)`                     | (replaced)  |
| `var(--surface)`, `var(--surface-alt)`      | `var(--card)`, `var(--muted)`     | (replaced)  |
| `var(--ink)`                                | `var(--foreground)`               | (replaced)  |
| `var(--focus)`                              | `var(--ring)`                     | (replaced)  |
| `#dc2626`, `#f87171`                        | `var(--destructive)`              | all         |
| `#16a34a`, `#4ade80`                        | `var(--success)`                  | all         |
| `#d97706`, `#f59e0b`, `#fbbf24`, `#b45309`  | `var(--warning)`                  | all         |
| `#2563eb`, `#60a5fa`                        | `var(--info)`                     | all         |
| `#7c3aed`, `#8b5cf6`, `#c4b5fd`             | `var(--ai)`                       | all         |
| `#0f766e`, `#5eead4`                        | `var(--primary)`                  | all         |
| `#9ca3af`, `#6b7280` (CSS contexts)         | `var(--muted-foreground)`         | all         |
| `#fff` (button text)                        | `var(--primary-foreground)`       | all         |
| `rgba(R,G,B,α)` tinted backgrounds          | `color-mix(in srgb, var(--X) α%, transparent)` | all |
| `rgba(15, 23, 42, 0.72)` (modal backdrop)   | `oklch(0 0 0 / 0.72)`             | 1           |

Four redundant `@media (prefers-color-scheme: dark)` override blocks were
deleted — they only swapped one shade of warning/destructive/success/info for
another, and the semantic tokens already auto-adapt between light and dark.

The `<select>` dropdown arrow SVG (a data-URI `background-image`) had its
`fill='%236b7280'` updated to `fill='%23737373'` — a neutral grey close to the
new `--muted-foreground`. CSS custom properties can't be referenced inside a
data URI, so this stays as a hex literal.

## Recommended follow-up tasks

1. Decide whether the gateway should opt into a `dark` class like the web app
   does, or keep the OS-level `prefers-color-scheme` media query. The web app's
   `globals.css` defines dark mode under `.dark`, not the media query, so
   matching the web app fully would mean wiring a theme toggle.
2. Once the renderer grows past a single HTML file, extract the `:root` block
   into a shared `theme.css` and `<link>` it.
3. Visually QA the gateway in both light and dark mode — the brand color
   shifted from teal to indigo, and several status colors moved between yellow
   shades. A few spots may want fine-tuning (e.g., the body's radial gradient
   now uses `--muted` which is a 12% alpha black tint over `--background`).
