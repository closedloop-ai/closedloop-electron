/**
 * ClosedLoop-authored Tailwind config for the embedded agent monitor.
 * Copied verbatim over the upstream `tailwind.config.js` at build time by
 * scripts/build-agent-monitor.mjs.
 *
 * Structure (color keys, fonts, animations) is kept identical to upstream so
 * every existing `bg-surface-*` / `text-accent` / `border-border` utility
 * still resolves. The token VALUES are remapped to the ClosedLoop brand:
 *   - `surface-*` moves from the upstream near-black blue scale to the brand
 *     cool-charcoal scale, so the embedded dashboard sits in the same tonal
 *     family as the host shell instead of reading as a separate app;
 *   - `border` follows the same charcoal shift;
 *   - `accent` becomes the brand primary (was the generic indigo #6366f1).
 * Hex values are kept (not oklch) so Tailwind `/<opacity>` modifiers work.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand cool-charcoal scale (0 = deepest page background,
        // 5 = lightest raised surface). Aligned with the host dark theme.
        surface: {
          0: "#202024",
          1: "#26262b",
          2: "#2b2b31",
          3: "#303037",
          4: "#3a3a42",
          5: "#45454e",
        },
        border: {
          DEFAULT: "#3a3a42",
          light: "#4a4a55",
        },
        // ClosedLoop brand primary (mirrors --primary in
        // packages/design-system/styles/globals.css).
        accent: {
          DEFAULT: "#3b63e8",
          hover: "#6485f0",
          muted: "rgba(59, 99, 232, 0.15)",
        },
      },
      fontFamily: {
        sans: ["Geist", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["Geist Mono", "JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
