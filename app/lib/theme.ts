export const THEMES = [
  { id: "neutral", label: "Neutral", swatch: "#5b8cff" },
  { id: "midnight", label: "Midnight", swatch: "#8b5cf6" },
  { id: "neon", label: "Neon", swatch: "#b14bff" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const PILLAR_LABELS: Record<string, string> = {
  "build-in-public": "build in public",
  "smart-ai-workflow": "smart AI workflow",
  "cool-repo": "cool repo",
  lesson: "lesson",
  "client-outcome": "client outcome",
};
