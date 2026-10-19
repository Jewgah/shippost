import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";
import { isDraftId } from "@/lib/draftId";
import { parseDraft } from "@/lib/draftParser";
import { recordPick } from "@/lib/voice";
import { STALE_MS } from "@/lib/runLock";
import { comfyBaseUrl } from "@/lib/comfy";
import {
  cardPath,
  cardsFor,
  imagesFor,
  isQueueId,
  itemPath,
  listQueue,
  nextQueued,
  queueDir,
  readItem,
  readRenderState,
  variantImagePath,
  writeItem,
  type QueueItem,
} from "@/lib/linkedinQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The manual LinkedIn post queue (see lib/linkedinQueue.ts). Nothing here is scheduled:
//  - POST {date, option, mode, text, repost} adds an item and starts its 3 image renders;
//  - POST {action: "trigger", id, image} posts the NEXT item, and only that one;
//  - GET lists the queue, and records a pick for every item that has been posted since.

const validOption = (n: number) => Number.isInteger(n) && n >= 1 && n <= 20;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A detached child whose output goes to a log file: a dev-server restart must not kill it. */
function spawnDetached(script: string, args: string[], logFile: string, env: NodeJS.ProcessEnv = process.env) {
  const { repoRoot } = loadConfig().resolved;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, "a");
  spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], {
    cwd: repoRoot,
    detached: true,
    env,
    stdio: ["ignore", out, out],
  }).unref();
  fs.closeSync(out);
}

/** The LinkedIn runner holds `.linkedin/.lock` for a whole run (a login window, a post, a repost). */
function runnerBusy(): boolean {
  try {
    return Date.now() - fs.statSync(path.join(queueDir(), ".lock")).mtimeMs < STALE_MS;
  } catch {
    return false;
  }
}
const BUSY = "the LinkedIn browser is already open (a login, a post or a repost): wait for it to close";

function renderingNow(): boolean {
  try {
    return Date.now() - fs.statSync(path.join(loadConfig().resolved.draftsDir, ".rendering")).mtimeMs < STALE_MS;
  } catch {
    return false;
  }
}

/**
 * The runner sets "posting" only AFTER taking its `.linkedin/.lock` and settles the status before
 * releasing it, so "posting" with no fresh lock means the run died (killed, machine restarted).
 * Left alone it would block every trigger forever, and only a queued or failed item can be
 * removed, so it is marked failed instead. It may or may not have gone out: the message says so.
 */
function settleDeadRuns(items: QueueItem[]): void {
  let alive = false;
  try {
    alive = Date.now() - fs.statSync(path.join(queueDir(), ".lock")).mtimeMs < STALE_MS;
  } catch {
    /* no lock: no run */
  }
  if (alive) return;
  for (const item of items) {
    if (item.status !== "posting") continue;
    item.status = "failed";
    item.error = "the posting run stopped before finishing: check LinkedIn before adding this post again";
    writeItem(item);
  }
}

export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;

  let b: Record<string, unknown> = {};
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    /* validated below */
  }
  if (b.action === "login") return login();
  return b.action === "trigger" ? trigger(b) : addToQueue(b);
}

// "Log in to LinkedIn": opens the poster's own browser on the LinkedIn login page, for the user to
// log in by hand (5 min). The session is kept in ~/.shippost/linkedin-profile; no password is stored.
function login() {
  if (listQueue().some((i) => i.status === "posting")) return bad("a post is going out right now, wait for it", 409);
  // Without this the runner would exit on the lock and the page would claim a window opened.
  if (runnerBusy()) return bad(BUSY, 409);
  const { repoRoot } = loadConfig().resolved;
  spawnDetached(path.join(repoRoot, "app", "scripts", "linkedin-post.mjs"), ["--login"], path.join(queueDir(), "login.log"));
  return NextResponse.json({ ok: true, started: true });
}

async function addToQueue(b: Record<string, unknown>) {
  const date = typeof b.date === "string" ? b.date : "";
  const option = Number(b.option);
  const mode = b.mode === "company" ? "company" : b.mode === "personal" ? "personal" : null;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const repost = typeof b.repost === "string" ? b.repost.trim() : "";
  const comment = typeof b.comment === "string" ? b.comment.trim() : "";
  const pageComment = typeof b.pageComment === "string" ? b.pageComment.trim() : "";

  if (!isDraftId(date) || !validOption(option)) return bad("invalid draft or option");
  if (!mode) return bad("mode must be personal or company");
  if (!text || text.length > 3000) return bad("post text must be 1-3000 characters");
  if (repost.length > 3000) return bad("repost caption is over 3000 characters");
  if (comment.length > 1250 || pageComment.length > 1250) return bad("a first comment is over 1250 characters (LinkedIn's comment limit)");

  const c = loadConfig();
  if (mode === "company" && !c.brand.linkedinPageUrl)
    return bad("set brand.linkedinPageUrl in config.json to post as the company");

  let md: string;
  try {
    md = fs.readFileSync(path.join(c.resolved.draftsDir, `${date}.md`), "utf8");
  } catch {
    return bad("draft not found", 404);
  }
  const opt = parseDraft(md).options.find((o) => o.n === option);
  if (!opt) return bad("that option is not in the draft", 404);

  const id = `${date}-o${option}-${crypto.randomBytes(3).toString("hex")}`;
  const item: QueueItem = {
    id,
    draft: date,
    option,
    topic: opt.topic,
    pillar: opt.pillar,
    mode,
    text,
    repost: mode === "company" ? repost : "",
    comment,
    pageComment: mode === "company" ? pageComment : "",
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  writeItem(item);

  // Adding is the deliberate click that may start ComfyUI, like "Render image". The URL is
  // resolved here and passed down so the renderer probes the same engine this app would.
  spawnDetached(
    path.join(c.resolved.repoRoot, "engine", "render-variants.mjs"),
    ["--job", id],
    path.join(queueDir(), `${id}.render.log`),
    { ...process.env, SHIPPOST_COMFY_URL: comfyBaseUrl() }
  );
  return NextResponse.json({ ok: true, item });
}

async function trigger(b: Record<string, unknown>) {
  const id = b.id;
  if (!isQueueId(id)) return bad("invalid id");
  const image = b.image === null || b.image === undefined ? null : Number(b.image);
  if (image !== null && !(Number.isInteger(image) && image >= 1 && image <= 4)) return bad("image must be 1, 2, 3, 4 (the video) or null");

  const items = listQueue();
  settleDeadRuns(items);
  const item = items.find((i) => i.id === id);
  if (!item) return bad("no such queue item", 404);
  if (item.status !== "queued") return bad(`this post is ${item.status}, not queued`, 409);
  if (items.some((i) => i.status === "posting")) return bad("a post is being published right now, wait for it", 409);
  // Any queued post can go out, in any order (Jordan, 2026-10-14: "this queue is limiting").
  // Renders never block a post (Jordan's call, 2026-10-14): it goes out as soon as the image it
  // uses exists (checked below), or with no image when that was picked. Posting while a render
  // runs is slower (chromium + a resident ~20 GB flux model swap the machine), never wrong.
  // A held lock means the spawned runner would exit at once and the item would silently stay queued.
  if (runnerBusy()) return bad(BUSY, 409);

  // The asset path is BUILT here from the validated id and integer, never taken from the client.
  let asset: string | null = null;
  if (image !== null) {
    asset = variantImagePath(id, image);
    if (!fs.existsSync(asset)) return bad("that image does not exist (yet)");
  }
  // The comment cards ride along when the clip produced them; a missing card means a text-only comment.
  // The logo card is the page's signature; the author's comment (on the repost, or on a personal post)
  // gets the takeaway card.
  const cards = cardsFor(id);
  const card = (kind: "post" | "repost") => (cards[kind] ? cardPath(id, kind) : null);
  writeItem({ ...item, asset, postCard: item.mode === "company" ? card("post") : card("repost"), repostCard: item.mode === "company" ? card("repost") : null, error: undefined });

  const { repoRoot } = loadConfig().resolved;
  spawnDetached(path.join(repoRoot, "app", "scripts", "linkedin-post.mjs"), ["--job", id], path.join(queueDir(), `${id}.log`));
  return NextResponse.json({ ok: true, started: true, id });
}

/**
 * The queue, oldest first, each item with its candidate images and render progress.
 * `?date&option` narrows it to one option (the card). Posted items are recorded as picks here,
 * the first time the app sees them, so the cadence bar and the voice corpus learn about a post
 * even when the page was closed while it went out.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const date = q.get("date");
  const optionParam = q.get("option");

  let items = listQueue();
  settleDeadRuns(items);
  for (const item of items) {
    if (item.status !== "posted" || item.picked) continue;
    // Marked first: a crash between the two would at worst miss one pick, never record it twice.
    writeItem({ ...item, picked: true });
    item.picked = true;
    recordPick({
      date: item.draft,
      option: item.option,
      pillar: item.pillar ?? "",
      topic: item.topic ?? "",
      companyPost: item.text,
      repostCaption: item.repost,
    });
  }

  if (date !== null || optionParam !== null) {
    const option = Number(optionParam);
    if (!date || !isDraftId(date) || !validOption(option)) return bad("invalid draft or option");
    const next = nextQueued(items);
    const position = new Map(items.filter((i) => i.status === "queued").map((i, n) => [i.id, n + 1]));
    items = items.filter((i) => i.draft === date && i.option === option);
    return NextResponse.json({
      items: items.map((i) => ({ ...i, position: position.get(i.id) ?? null, images: imagesFor(i.id), cards: cardsFor(i.id), render: readRenderState(i.id) })),
      nextId: next?.id ?? null,
    });
  }

  return NextResponse.json({
    items: items.map((i) => ({ ...i, images: imagesFor(i.id), cards: cardsFor(i.id), render: readRenderState(i.id) })),
    nextId: nextQueued(items)?.id ?? null,
    rendering: renderingNow(),
    hasCompanyPage: Boolean(loadConfig().brand.linkedinPageUrl),
  });
}

// Remove an item that was never posted (queued, or a post that failed before going out). Its
// images stay in .visuals.
export async function DELETE(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!isQueueId(id)) return bad("invalid id");
  const item = readItem(id);
  if (!item) return bad("no such queue item", 404);
  if (item.status !== "queued" && item.status !== "failed") return bad("only a queued or failed post can be removed", 409);
  fs.unlinkSync(itemPath(id));
  return NextResponse.json({ ok: true });
}
