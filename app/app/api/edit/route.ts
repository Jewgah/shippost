import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { blockCrossSite } from "@/lib/guard";
import { cleanField } from "@/lib/steering";
import { isDraftId } from "@/lib/draftId";
import { channelPaths, resolveChannel } from "@/lib/channel";
import { acquireRunLock, releaseRunLock } from "@/lib/runLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Revise a single option in an existing draft. Reuses the `.generating` lock +
// `.last_generate.json` so the existing GET /api/generate reports progress and no
// edit/generate runs overlap. Poll GET /api/generate for completion.
export async function POST(req: Request) {
  const blocked = blockCrossSite(req);
  if (blocked) return blocked;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* validated below */
  }
  const date = typeof body.date === "string" ? body.date : "";
  const option = Number(body.option);
  // "Generate for company": a fixed rewrite (section D) instead of a free-form instruction.
  const company = body.company === true;
  const prompt = company ? "company" : cleanField(body.prompt, 800);

  const channel = resolveChannel(body.channel);
  if (!channel) return NextResponse.json({ error: "unknown channel" }, { status: 400 });
  if (!isDraftId(date)) return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  if (!Number.isInteger(option) || option < 1 || option > 20)
    return NextResponse.json({ error: "invalid option" }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: "empty prompt" }, { status: 400 });

  const { resolved } = loadConfig();
  const cp = channelPaths(channel);
  const file = path.join(cp.dir, `${date}.md`);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "draft not found" }, { status: 404 });

  const lock = path.join(resolved.draftsDir, ".generating");
  const result = cp.result;
  const token = acquireRunLock(lock);
  if (!token) return NextResponse.json({ started: false, running: true });

  const script = path.join(resolved.repoRoot, "engine", "edit.sh");
  const child = spawn("bash", [script], {
    cwd: resolved.repoRoot,
    env: {
      ...process.env,
      SHIPPOST_EDIT_FILE: file,
      SHIPPOST_EDIT_OPTION: String(option),
      SHIPPOST_EDIT_PROMPT: prompt,
      SHIPPOST_EDIT_MODE: company ? "company" : "",
      SHIPPOST_CHANNEL: channel,
    },
    stdio: "ignore",
  });

  const finish = (ok: boolean, extra: Record<string, unknown> = {}) => {
    try {
      fs.writeFileSync(result, JSON.stringify({ ok, date, finishedAt: Date.now(), edited: option, ...extra }));
    } catch {
      /* ignore */
    }
    releaseRunLock(lock, token); // compare-and-delete: never unlinks a newer run's lock
  };
  child.on("error", (err) => finish(false, { error: String(err) }));
  child.on("close", (code) =>
    finish(code === 0, code === 3 ? { code, error: "The AI answered but the draft was not changed. Try again; details in drafts/.run.log" } : { code })
  );

  return NextResponse.json({ started: true, running: true, date, option });
}
