import "server-only";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

// App settings the user can change at runtime, persisted to the drafts dir (the app
// never mutates config.json). Default is personal-only; company mode is opt-in.
export interface AppSettings {
  companyMode: boolean;
}
const DEFAULTS: AppSettings = { companyMode: false };

const IMG_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

function settingsPath(): string {
  return path.join(loadConfig().resolved.draftsDir, ".shippost-settings.json");
}

export function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { companyMode: Boolean(raw.companyMode) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const { resolved } = loadConfig();
  fs.mkdirSync(resolved.draftsDir, { recursive: true });
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

// Uploaded brand logo / author avatar live in the drafts dir as hidden files.
function findUploaded(stem: string): string | null {
  const { resolved } = loadConfig();
  for (const e of IMG_EXTS) {
    const p = path.join(resolved.draftsDir, stem + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function uploadedAvatarPath(): string | null {
  return findUploaded(".author-avatar");
}

/** Effective logo: an uploaded one (drafts dir) wins over the configured brand logo. */
export function effectiveLogoPath(): string | null {
  const uploaded = findUploaded(".brand-logo");
  if (uploaded) return uploaded;
  const { brand } = loadConfig();
  return brand.logoPath && fs.existsSync(brand.logoPath) ? brand.logoPath : null;
}
