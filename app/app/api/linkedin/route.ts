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
  return b.action === "trigger" ? trigger(b) : addToQueue(b);
}

async function addToQueue(b: Record<string, unknown>) {
  const date = typeof b.date === "string" ? b.date : "";
  const option = Number(b.option);
  const mode = b.mode === "company" ? "company" : b.mode === "personal" ? "personal" : null;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const repost = typeof b.repost === "string" ? b.repost.trim() : "";

  if (!isDraftId(date) || !validOption(option)) return bad("invalid draft or option");
  if (!mode) return bad("mode must be personal or company");
  if (!text || text.length > 3000) return bad("post text must be 1-3000 characters");
  if (repost.length > 3000) return bad("repost caption is over 3000 characters");

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
  if (image !== null && !(Number.isInteger(image) && image >= 1 && image <= 3)) return bad("image must be 1, 2, 3 or null");

  const items = listQueue();
  settleDeadRuns(items);
  const item = items.find((i) => i.id === id);
  if (!item) return bad("no such queue item", 404);
  if (item.status !== "queued") return bad(`this post is ${item.status}, not queued`, 409);
  if (items.some((i) => i.status === "posting")) return bad("a post is being published right now, wait for it", 409);
  // Strict FIFO: a stale page must never post out of order.
  if (nextQueued(items)?.id !== id) return bad("this is not the next post in the queue, reload the page", 409);
  // chromium + a resident ~20 GB flux model swaps the machine (same rule as build-carousel.mjs).
  if (renderingNow()) return bad("images are still rendering, try again in a minute", 409);

  // The asset path is BUILT here from the validated id and integer, never taken from the client.
  let asset: string | null = null;
  if (image !== null) {
    asset = variantImagePath(id, image);
    if (!fs.existsSync(asset)) return bad("that image does not exist (yet)");
  }
  writeItem({ ...item, asset, error: undefined });

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
      items: items.map((i) => ({ ...i, position: position.get(i.id) ?? null, images: imagesFor(i.id), render: readRenderState(i.id) })),
      nextId: next?.id ?? null,
    });
  }

  return NextResponse.json({
    items: items.map((i) => ({ ...i, images: imagesFor(i.id), render: readRenderState(i.id) })),
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
