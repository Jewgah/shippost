import "server-only";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

/**
 * The manual LinkedIn post queue. One JSON file per item in `<draftsDir>/.linkedin/<id>.json`,
 * listed oldest first by `createdAt`. Nothing here is scheduled, and any queued item can go out:
 * it waits until Jordan clicks its "Post" button in the queue panel (top bar).
 *
 * Writers:
 *  - this app writes the item JSON (create, the trigger's `asset`, `picked`);
 *  - app/scripts/linkedin-post.mjs writes the item JSON's `status`, `urn` and follow-up flags
 *    (under its own lock, re-reading before each write). GET's `picked` write can overlap the
 *    runner's follow-up writes; both are read-then-write within milliseconds, so this is accepted;
 *  - engine/render-variants.mjs writes `<id>.render.json`, the clip's props `<id>.clip.json`, and the images
 *    `<draftsDir>/.visuals/<id>-v{1,2,3}.png`, plus the clip `<id>-v4.mp4` when config `video` is
 *    set. Candidates are found by looking, never stored here;
 *  - attachVideo() (called by POST /api/linkedin when the option declares `_Video:_`) copies the
 *    author's own video to `<id>-v5.mp4`, and the item records the source path as `attachVideo`.
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
  /** First comment by the author: on the personal post, or on the repost in company mode. */
  comment?: string;
  /** Company mode: the page's own comment on its post (the page's voice, the company's site). */
  pageComment?: string;
  /** Set by the trigger when the cards exist: the image attached under each first comment. */
  postCard?: string | null;
  repostCard?: string | null;
  status: QueueStatus;
  asset?: string | null;
  error?: string;
  createdAt: string;
  postedAt?: string;
  startedAt?: string;
  urn?: string;
  repostUrn?: string | null;
  commented?: boolean;
  repostCommented?: boolean;
  picked?: boolean;
  reposted?: boolean;
  /** The author's own video the option declared (`_Video:_`), copied to candidate 5. Provenance only: posting reads the copy. */
  attachVideo?: string;
}

export interface RenderState {
  state: "waiting" | "rendering" | "done" | "failed";
  done: number;
  total?: number;
  error?: string;
}

export const VARIANTS = [1, 2, 3] as const;
/** The 4th candidate is a video (a marketing-studio clip), picked and posted like an image. */
export const VIDEO = 4;
/** The 5th candidate is the author's own video, copied in at queue time (see attachVideo). */
export const ATTACHED = 5;
export const CANDIDATES = [...VARIANTS, VIDEO, ATTACHED] as const;
const isVideoCandidate = (v: number) => v === VIDEO || v === ATTACHED;

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
/** The candidate `v` of an item: images 1-3, the clip 4, the author's video 5. Built from a validated id and an integer only. */
export const variantImagePath = (id: string, v: number) => path.join(visualsDir(), `${id}-v${v}.${isVideoCandidate(v) ? "mp4" : "png"}`);

/**
 * The size cap on an attached video. /api/asset reads a candidate whole into memory on every
 * request (the board's <video> asks for byte ranges repeatedly), so the cap bounds that, and a
 * LinkedIn feed clip is well under it in practice (the Remotion clip is a few MB).
 */
export const ATTACH_MAX_BYTES = 200 * 1024 * 1024;

/** Why `file` cannot be attached, or null when it can: an absolute path to an existing .mp4 file, at most ATTACH_MAX_BYTES. */
export function attachVideoError(file: string): string | null {
  if (!file) return "no video path given";
  if (!path.isAbsolute(file)) return `the video path must be absolute: ${file}`;
  if (path.extname(file).toLowerCase() !== ".mp4") return `the video must be an .mp4 file: ${file}`;
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return `the video does not exist: ${file}`;
  }
  if (!st.isFile()) return `the video is not a file: ${file}`;
  if (st.size === 0) return `the video is empty: ${file}`;
  if (st.size > ATTACH_MAX_BYTES)
    return `the video is ${Math.ceil(st.size / 1024 / 1024)} MB, over the ${ATTACH_MAX_BYTES / 1024 / 1024} MB limit: ${file}`;
  return null;
}

/**
 * Copy (never move) the author's video to candidate 5 of item `id`. Copied under a temp name and
 * renamed, so imagesFor never lists half a file. Throws with attachVideoError's message on a bad file.
 */
export function attachVideo(id: string, file: string): string {
  if (!isQueueId(id)) throw new Error("invalid queue id");
  const err = attachVideoError(file);
  if (err) throw new Error(err);
  fs.mkdirSync(visualsDir(), { recursive: true });
  const dest = variantImagePath(id, ATTACHED);
  const tmp = path.join(visualsDir(), `${id}-v${ATTACHED}.tmp.mp4`);
  try {
    // A copy-on-write clone where the filesystem has one (APFS), a plain copy elsewhere.
    fs.copyFileSync(file, tmp, fs.constants.COPYFILE_FICLONE);
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return dest;
}

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

/**
 * The comment cards cut from the clip: `post` (the end card, logo + site) goes under the page's
 * comment, `repost` (the takeaway beat) under the author's comment (on the repost, or on a personal post).
 */
export type CardKind = "post" | "repost";
export const cardPath = (id: string, kind: CardKind) => path.join(visualsDir(), `${id}-card-${kind}.gif`);
export function cardsFor(id: string): Record<CardKind, boolean> {
  if (!isQueueId(id)) return { post: false, repost: false };
  return { post: fs.existsSync(cardPath(id, "post")), repost: fs.existsSync(cardPath(id, "repost")) };
}

/** Which candidates (images 1-3, clip 4, the author's video 5) exist on disk right now. */
export function imagesFor(id: string): number[] {
  if (!isQueueId(id)) return [];
  return CANDIDATES.filter((v) => fs.existsSync(variantImagePath(id, v)));
}

export function readRenderState(id: string): RenderState | null {
  if (!isQueueId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(renderStatePath(id), "utf8")) as RenderState;
  } catch {
    return null;
  }
}
