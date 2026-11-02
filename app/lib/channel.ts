import path from "node:path";
import { loadConfig } from "./config";

/** A posting channel. LinkedIn is the original, flat layout; X lives in an `x/` subfolder. */
export type Channel = "linkedin" | "x";

export const CHANNELS: readonly Channel[] = ["linkedin", "x"];

export function isChannel(v: unknown): v is Channel {
  return v === "linkedin" || v === "x";
}

/**
 * Resolve a request's channel value: absent (undefined, null or "") means LinkedIn, a known value
 * is itself, anything else is null so the route can answer 400.
 */
export function resolveChannel(v: unknown): Channel | null {
  if (v === undefined || v === null || v === "") return "linkedin";
  return isChannel(v) ? v : null;
}

export interface ChannelPaths {
  dir: string;
  picks: string;
  rejects: string;
  corpus: string;
  result: string;
}

/** Every file a channel owns. The generation lock `.generating` stays in the root, shared. */
export function channelPaths(channel: Channel = "linkedin"): ChannelPaths {
  const { resolved } = loadConfig();
  if (channel === "linkedin") {
    return {
      dir: resolved.draftsDir,
      picks: resolved.picksLogPath,
      rejects: resolved.rejectsLogPath,
      corpus: resolved.recentPostsPath,
      result: path.join(resolved.draftsDir, ".last_generate.json"),
    };
  }
  const dir = path.join(resolved.draftsDir, "x");
  return {
    dir,
    picks: path.join(dir, path.basename(resolved.picksLogPath)),
    rejects: path.join(dir, path.basename(resolved.rejectsLogPath)),
    corpus: path.join(dir, path.basename(resolved.recentPostsPath)),
    result: path.join(dir, ".last_generate.json"),
  };
}

export function channelDir(channel: Channel = "linkedin"): string {
  return channelPaths(channel).dir;
}
