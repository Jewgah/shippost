import "server-only";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

/**
 * The manual LinkedIn post queue. One JSON file per item in `<draftsDir>/.linkedin/<id>.json`,
 * oldest first (FIFO by `createdAt`). Nothing here is scheduled: an item waits until Jordan
 * clicks "Trigger next post" on /queue.
 *
 * Three writers, each owning its own file, so none ever rewrites another's:
 *  - this app writes the item JSON (create, the trigger's `asset`, `picked`);
 *  - app/scripts/linkedin-post.mjs writes the item JSON's `status` while posting (it runs only
 *    after the app's last write for that item, under its own lock);
 *  - engine/render-variants.mjs writes `<id>.render.json` and the images
 *    `<draftsDir>/.visuals/<id>-v{1,2,3}.png`. Images are found by looking, never stored here.
 */

export type QueueMode = "personal" | "company";
export type QueueStatus = "queued" | "posting" | "posted" | "failed";

export interface QueueItem {
  id: string;
  draft: string;
  option: number;
  topic: string;
  pillar?: string;
  mode: QueueMode;
  text: string;
  repost: string;
  status: QueueStatus;
  asset?: string | null;
  error?: string;
  createdAt: string;
  postedAt?: string;
  picked?: boolean;
  reposted?: boolean;
}

export interface RenderState {
  state: "waiting" | "rendering" | "done" | "failed";
  done: number;
  total?: number;
  error?: string;
}

export const VARIANTS = [1, 2, 3] as const;

/** Item ids are built server-side, but they also arrive in query strings: only this shape is used in a path. */
export const isQueueId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(id);

export function queueDir(): string {
  return path.join(loadConfig().resolved.draftsDir, ".linkedin");
}

export function visualsDir(): string {
  return path.join(loadConfig().resolved.draftsDir, ".visuals");
}

export const itemPath = (id: string) => path.join(queueDir(), `${id}.json`);
export const renderStatePath = (id: string) => path.join(queueDir(), `${id}.render.json`);
/** The candidate image `v` (1-3) of an item. Built from a validated id and an integer only. */
export const variantImagePath = (id: string, v: number) => path.join(visualsDir(), `${id}-v${v}.png`);

export function readItem(id: string): QueueItem | null {
  if (!isQueueId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(itemPath(id), "utf8")) as QueueItem;
  } catch {
    return null;
  }
}

/** tmp-then-rename, so a reader (the poller, the runner) never sees half a JSON file. */
export function writeItem(item: QueueItem): void {
  fs.mkdirSync(queueDir(), { recursive: true });
  const file = itemPath(item.id);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(item, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/** Every item, oldest first. `<id>.render.json` and other side files never match the name test. */
export function listQueue(): QueueItem[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(queueDir()).filter((f) => /^[A-Za-z0-9_-]+\.json$/.test(f));
  } catch {
    return []; // no queue yet
  }
  const items: QueueItem[] = [];
  for (const f of files) {
    const item = readItem(f.slice(0, -".json".length));
    if (item && typeof item.id === "string" && typeof item.status === "string") items.push(item);
  }
  return items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
}

/** The one item "Trigger next post" may post: the oldest still queued. */
export function nextQueued(items: QueueItem[] = listQueue()): QueueItem | null {
  return items.find((i) => i.status === "queued") ?? null;
}

/** Which of the 3 candidate images exist on disk right now. */
export function imagesFor(id: string): number[] {
  if (!isQueueId(id)) return [];
  return VARIANTS.filter((v) => fs.existsSync(variantImagePath(id, v)));
}

export function readRenderState(id: string): RenderState | null {
  if (!isQueueId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(renderStatePath(id), "utf8")) as RenderState;
  } catch {
    return null;
  }
}
