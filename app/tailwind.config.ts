import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Colors are driven by CSS variables (see globals.css) so the ThemeSwitcher
      // can swap presets at runtime by setting [data-theme] on <html>.
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        elevated: "var(--elevated)",
        border: "var(--border)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        accent2: "var(--accent2)",
        good: "var(--good)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px var(--border), 0 8px 40px -12px var(--accent-glow)",
      },
      keyframes: {
        "glow-breathe": {
          "0%,100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "glow-breathe": "glow-breathe 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
