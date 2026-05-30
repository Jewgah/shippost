"use client";
import { useEffect, useState } from "react";
import { THEMES } from "@/lib/theme";

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("neutral");

  useEffect(() => {
    const saved =
      localStorage.getItem("shippost-theme") ||
      document.documentElement.dataset.theme ||
      "neutral";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  const choose = (id: string) => {
    setTheme(id);
    document.documentElement.dataset.theme = id;
    localStorage.setItem("shippost-theme", id);
  };

  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-surface/60 p-1">
      {THEMES.map((t) => (
        <button
          key={t.id}
          onClick={() => choose(t.id)}
          title={t.label}
          aria-label={t.label}
          className={`h-5 w-5 rounded-full transition ${
            theme === t.id ? "ring-2 ring-fg ring-offset-1 ring-offset-surface" : "opacity-70 hover:opacity-100"
          }`}
          style={{ background: t.swatch }}
        />
      ))}
    </div>
  );
}
