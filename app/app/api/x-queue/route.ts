import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";
import { isDraftId } from "@/lib/draftId";
import { parseDraft } from "@/lib/draftParser";
import { recordPick } from "@/lib/voice";
import { STALE_MS } from "@/lib/runLock";
import { comfyBaseUrl } from "@/lib/comfy";
import { spawnDetached } from "@/lib/spawnDetached";
import { X_LIMIT, xLength } from "@/lib/xText";
import {
  imagesFor,
  isQueueId,
  itemPath,
  listQueue,
  queueDir,
  readItem,
  readRenderState,
  variantImagePath,
  writeItem,
  type QueueItem,
} from "@/lib/linkedinQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The manual X post queue: the LinkedIn queue's shape under <draftsDir>/x/ (lib/linkedinQueue.ts).
// Nothing here is scheduled and nothing here talks to X: app/scripts/x-post.mjs does, on a click.
//  - POST {date, option, text, thread, reply} adds an item and starts its 3 image renders (16:9);
//  - POST {action: "trigger", id, image} posts that item, with candidate `image` or none;
//  - POST {action: "requeue", id} puts a failed item back, keeping the ids already posted;
//  - POST {action: "check"} runs `x-post.mjs --check` and answers with its line;
//  - GET lists the X items, and whether the keys file exists (never what it holds).

const CH = "x" as const;
const MAX_THREAD = 5;
const validOption = (n: number) => Number.isInteger(n) && n >= 1 && n <= 20;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const keysFile = () => path.join(os.homedir(), ".shippost", "x-keys.json");
const poster = () => path.join(loadConfig().resolved.repoRoot, "app", "scripts", "x-post.mjs");

/** The X runner holds `x/.queue/.lock` for a whole run. */
function runnerAlive(): boolean {
  try {
    return Date.now() - fs.statSync(path.join(queueDir(CH), ".lock")).mtimeMs < STALE_MS;
  } catch {
    return false;
  }
}

/**
 * "posting" with no fresh lock means the run died (killed, machine restarted): marked failed so it
 * stops blocking every trigger. Its `xIds` stay, so a retry continues the chain.
 */
function settleDeadRuns(items: QueueItem[]): void {
  if (runnerAlive()) return;
  for (const item of items) {
    if (item.status !== "posting") continue;
    item.status = "failed";
    item.error = "the posting run stopped before finishing: check x.com before retrying";
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
  if (b.action === "trigger") return trigger(b);
  if (b.action === "requeue") return requeue(b);
  if (b.action === "check") return check();
  if (b.action !== undefined) return bad("unknown action");
  return addToQueue(b);
}

/** Every post of the chain within X's 280 (weighted), or the reason it is not. */
function overLimit(posts: Array<{ label: string; text: string }>): string | null {
  for (const p of posts) {
    const n = xLength(p.text);
    if (n > X_LIMIT) return `${p.label} is ${n} characters the way X counts them, over ${X_LIMIT}`;
  }
  return null;
}

function addToQueue(b: Record<string, unknown>) {
  const date = typeof b.date === "string" ? b.date : "";
  const option = Number(b.option);
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const reply = typeof b.reply === "string" ? b.reply.trim() : "";
  const rawThread = b.thread === undefined || b.thread === null ? [] : b.thread;

  if (!isDraftId(date) || !validOption(option)) return bad("invalid draft or option");
  if (!text) return bad("the post has no text");
  if (!Array.isArray(rawThread) || rawThread.some((t) => typeof t !== "string")) return bad("thread must be a list of posts");
  const thread = (rawThread as string[]).map((t) => t.trim()).filter(Boolean);
  if (thread.length > MAX_THREAD) return bad(`a thread holds at most ${MAX_THREAD} posts, this one has ${thread.length}`);
  const over = overLimit([
    { label: "the post", text },
    ...thread.map((t, i) => ({ label: `thread post ${i + 2}/`, text: t })),
    { label: "the link reply", text: reply },
  ]);
  if (over) return bad(over);

  const c = loadConfig();
  let md: string;
  try {
    md = fs.readFileSync(path.join(c.resolved.draftsDir, "x", `${date}.md`), "utf8");
  } catch {
    return bad("that X draft does not exist");
  }
  const opt = parseDraft(md).options.find((o) => o.n === option);

  const id = `${date}-o${option}-${crypto.randomBytes(3).toString("hex")}`;
  const item: QueueItem = {
    id,
    channel: CH,
    draft: date,
    option,
    topic: opt?.topic ?? "",
    pillar: opt?.pillar,
    mode: "personal",
    text,
    repost: "",
    thread,
    comment: reply,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  writeItem(item);

  // Adding is the deliberate click that may start ComfyUI, as on LinkedIn.
  spawnDetached(
    path.join(c.resolved.repoRoot, "engine", "render-variants.mjs"),
    ["--job", id, "--channel", CH],
    path.join(queueDir(CH), `${id}.render.log`),
    { ...process.env, SHIPPOST_COMFY_URL: comfyBaseUrl() }
  );
  return NextResponse.json({ ok: true, item });
}

function trigger(b: Record<string, unknown>) {
  const id = b.id;
  if (!isQueueId(id)) return bad("invalid id");
  const image = b.image === null || b.image === undefined ? null : Number(b.image);
  if (image !== null && !(Number.isInteger(image) && image >= 1 && image <= 4))
    return bad("image must be 1, 2, 3, 4 (the clip) or null");

  const items = listQueue(CH);
  settleDeadRuns(items);
  const item = items.find((i) => i.id === id);
  if (!item) return bad("no such queue item", 404);
  if (item.status !== "queued") return bad(`this post is ${item.status}, not queued`, 409);
  if (items.some((i) => i.status === "posting") || runnerAlive()) return bad("an X post is going out right now, wait for it", 409);

  // Built here from the validated id and integer, never taken from the client.
  let asset: string | null = null;
  if (image !== null) {
    asset = variantImagePath(id, image, CH);
    if (!fs.existsSync(asset)) return bad("that image does not exist (yet)");
  }
  writeItem({ ...item, asset, error: undefined });
  spawnDetached(poster(), ["--job", id], path.join(queueDir(CH), `${id}.log`));
  return NextResponse.json({ ok: true, started: true, id });
}

/** A failed item goes back to the queue with its `xIds`: the next Post continues the chain. */
function requeue(b: Record<string, unknown>) {
  const id = b.id;
  if (!isQueueId(id)) return bad("invalid id");
  const item = readItem(id, CH);
  if (!item) return bad("no such queue item", 404);
  if (item.status !== "failed") return bad(`this post is ${item.status}: only a failed one goes back`, 409);
  writeItem({ ...item, channel: CH, status: "queued", error: undefined });
  return NextResponse.json({ ok: true, item: readItem(id, CH) });
}

/** `x-post.mjs --check` (GET /2/users/me): its last line, e.g. "X keys work: @handle". */
function check(): Promise<NextResponse> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", poster(), "--check"], {
      cwd: loadConfig().resolved.repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const add = (c: Buffer) => (out = (out + c.toString()).slice(-4000));
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    const done = (code: number | null) => {
      clearTimeout(timer);
      const line = out.trim().split("\n").filter((l) => !/warning/i.test(l) || /chmod/.test(l)).pop() ?? "";
      res(NextResponse.json({ ok: code === 0, message: line || (code === null ? "the check timed out" : `the check exited ${code}`) }, { status: code === 0 ? 200 : 502 }));
    };
    child.on("error", () => done(1));
    child.on("close", done);
  });
}

/** The X items, oldest first, with their candidates and render progress. Posted items are recorded as X picks once. */
export async function GET() {
  const items = listQueue(CH);
  settleDeadRuns(items);
  for (const item of items) {
    if (item.status !== "posted" || item.picked) continue;
    writeItem({ ...item, picked: true });
    item.picked = true;
    recordPick({ date: item.draft, option: item.option, pillar: item.pillar ?? "", topic: item.topic ?? "", companyPost: item.text, channel: CH });
  }
  return NextResponse.json({
    items: items.map((i) => ({ ...i, images: imagesFor(i.id, CH), render: readRenderState(i.id, CH) })),
    hasKeys: fs.existsSync(keysFile()),
  });
}

// Remove a queued or failed X item. Its images stay in x/.visuals.
export async function DELETE(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!isQueueId(id)) return bad("invalid id");
  const item = readItem(id, CH);
  if (!item) return bad("no such queue item", 404);
  if (item.status !== "queued" && item.status !== "failed") return bad("only a queued or failed post can be removed", 409);
  fs.unlinkSync(itemPath(id, CH));
  return NextResponse.json({ ok: true });
}
