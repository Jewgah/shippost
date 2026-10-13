#!/usr/bin/env node
/**
 * render-variants.mjs - render the 3 candidate images of ONE queued LinkedIn post.
 *
 * Usage:
 *   node engine/render-variants.mjs --job <id>
 *
 * Reads the queue item <draftsDir>/.linkedin/<id>.json (written by POST /api/linkedin, which
 * spawns this detached), takes the option's AI prompts from <draftsDir>/<draft>.md through
 * variantPrompts() in app/lib/draftParser.ts, and runs engine/render-visual.mjs once per variant
 * with --out-file <id>-vN.png into <draftsDir>/.visuals/.
 *
 * Progress goes to <draftsDir>/.linkedin/<id>.render.json, and ONLY this script writes it:
 *   { state: "waiting"|"rendering"|"done"|"failed", done: n, total: n, error? }
 * The item JSON itself is never written here (the app and the poster own it), so a render can
 * never undo a status change.
 *
 * Same rules as app/app/api/render/route.ts, mirrored rather than imported (that route's helpers
 * are `server-only`, which throws outside a Next bundle):
 *  - the `.rendering` lock is shared with /api/render and engine/generate.sh, so renders never
 *    overlap. A held lock is waited for (polled every 10 s, state "waiting"), never stolen while
 *    fresh, and ours is heartbeated every minute because 3 renders plus an engine start can
 *    outlast the 15 minute staleness window;
 *  - ComfyUI is started with engine/comfy-headless.sh when it is down AND on this machine:
 *    adding to the queue is a deliberate click, the same decision as "Render image". A remote
 *    engine that does not answer is reported as failed instead (that script only ever starts a
 *    local server).
 * A failed render leaves the item queued: it can still be posted, text only.
 *
 * Node >= 22.18 (type stripping): this imports the app's TypeScript directly, like
 * app/scripts/build-carousel.mjs, so the prompt and seed rules live in one tested place.
 *
 * Exit codes: 0 rendered (or nothing to render) · 1 bad input or a failed render.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
// Mirrors app/lib/runLock.ts's STALE_MS.
const STALE_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 60_000;
const WAIT_POLL_MS = 10_000;
// A lock that stays fresh this long is someone else's stuck heartbeat, not a render to wait for.
const MAX_WAIT_MS = 2 * 60 * 60 * 1000;

const expandTilde = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString(), ...m);

function loadConfig() {
  const file = process.env.SHIPPOST_CONFIG ? expandTilde(process.env.SHIPPOST_CONFIG) : join(ROOT, 'config.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** Same resolution as app/lib/comfy.ts comfyBaseUrl (and engine/comfy-headless.sh). */
function comfyBaseUrl(env = process.env) {
  const url = (env.SHIPPOST_COMFY_URL ?? '').trim().replace(/\/+$/, '');
  if (url) return url;
  const port = (env.SHIPPOST_COMFY_PORT ?? '').trim();
  return /^\d+$/.test(port) ? `http://127.0.0.1:${port}` : 'http://127.0.0.1:8188';
}

/** Same rule as app/lib/comfy.ts canStartLocally. */
function canStartLocally(base) {
  try {
    return ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'].includes(new URL(base).hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function comfyIsUp(base) {
  try {
    return (await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

// --- the shared `.rendering` lock: same O_EXCL + owner token + compare-and-delete as runLock.ts ---
function acquireLock(lock) {
  const token = `${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const tryCreate = () => {
    try {
      writeFileSync(lock, token, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      return false;
    }
  };
  if (tryCreate()) return token;
  try {
    if (Date.now() - statSync(lock).mtimeMs < STALE_MS) return null;
    unlinkSync(lock);
  } catch {
    /* raced with the holder's cleanup: retry the create */
  }
  return tryCreate() ? token : null;
}
function touchLock(lock, token) {
  try {
    if (readFileSync(lock, 'utf8') !== token) return;
    const now = new Date();
    utimesSync(lock, now, now);
  } catch {
    /* gone */
  }
}
function releaseLock(lock, token) {
  try {
    if (readFileSync(lock, 'utf8') === token) unlinkSync(lock);
  } catch {
    /* already gone */
  }
}

/** Run a child to completion; resolves its exit code and the tail of its stderr. */
function run(cmd, argv, opts) {
  return new Promise((res) => {
    const child = spawn(cmd, argv, { ...opts, stdio: ['ignore', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => {
      process.stderr.write(c);
      stderr = (stderr + c.toString()).slice(-2000);
    });
    child.on('error', (e) => res({ code: null, stderr: String(e) }));
    child.on('close', (code) => res({ code, stderr }));
  });
}
const lastLine = (s) => s.trim().split('\n').filter(Boolean).pop() ?? '';

async function main() {
  if (!process.features.typescript) {
    console.error(`needs Node >= 22.18 (it imports the app's TypeScript); this is ${process.version}`);
    return 1;
  }
  const args = process.argv.slice(2);
  const i = args.indexOf('--job');
  const id = i >= 0 ? args[i + 1] ?? '' : '';
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
    console.error('usage: render-variants.mjs --job <id>');
    return 1;
  }

  const cfg = loadConfig();
  const draftsDir = expandTilde(cfg?.output?.draftsDir || '~/Downloads/shippost-drafts');
  const queueDir = join(draftsDir, '.linkedin');
  const visualsDir = join(draftsDir, '.visuals');
  const lock = join(draftsDir, '.rendering');
  const stateFile = join(queueDir, `${id}.render.json`);
  const setState = (s) => {
    try {
      writeFileSync(`${stateFile}.tmp`, JSON.stringify(s));
      renameSync(`${stateFile}.tmp`, stateFile);
    } catch {
      /* progress is a hint for the UI, never a correctness input */
    }
  };

  let item;
  try {
    item = JSON.parse(readFileSync(join(queueDir, `${id}.json`), 'utf8'));
  } catch {
    console.error(`no such queue item: ${id}`);
    return 1;
  }
  let md;
  try {
    md = readFileSync(join(draftsDir, `${item.draft}.md`), 'utf8');
  } catch {
    setState({ state: 'failed', done: 0, error: `the draft ${item.draft} is gone` });
    return 1;
  }

  const { parseDraft, variantPrompts } = await import(pathToFileURL(join(ROOT, 'app', 'lib', 'draftParser.ts')).href);
  const option = parseDraft(md).options.find((o) => o.n === Number(item.option));
  // A per-item salt, so the same option queued twice gets new images rather than the same three.
  const salt = [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0);
  const variants = option ? variantPrompts(option.visual, salt) : [];
  const total = variants.length;
  if (!total) {
    setState({ state: 'done', done: 0, total: 0 });
    log(`job ${id}: no AI prompt on this option, nothing to render`);
    return 0;
  }

  // Wait our turn: never two 20 GB model loads at once.
  const waitStart = Date.now();
  let token = acquireLock(lock);
  while (!token) {
    setState({ state: 'waiting', done: 0, total });
    if (Date.now() - waitStart > MAX_WAIT_MS) {
      setState({ state: 'failed', done: 0, total, error: 'another render held the image engine for over 2 hours' });
      return 1;
    }
    await sleep(WAIT_POLL_MS);
    token = acquireLock(lock);
  }
  const beat = setInterval(() => touchLock(lock, token), HEARTBEAT_MS);
  const release = () => {
    clearInterval(beat);
    releaseLock(lock, token);
  };
  // A killed renderer must not leave a fresh lock that blocks every render for 15 minutes.
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => (release(), process.exit(1)));

  try {
    const base = comfyBaseUrl();
    if (!(await comfyIsUp(base))) {
      if (!canStartLocally(base)) {
        setState({
          state: 'failed',
          done: 0,
          total,
          error: `The image engine at ${base} is not answering, and it is not on this machine, so it can't be started from here.`,
        });
        return 1;
      }
      setState({ state: 'rendering', done: 0, total, note: 'starting the image engine' });
      const started = await run('bash', [join(ROOT, 'engine', 'comfy-headless.sh')], { cwd: ROOT, env: process.env });
      if (started.code !== 0) {
        const why = started.stderr.split('\n').map((l) => l.trim()).find((l) => l.startsWith('shippost:')) || lastLine(started.stderr);
        setState({ state: 'failed', done: 0, total, error: `Couldn't start the image engine${why ? `: ${why}` : ''}` });
        return 1;
      }
    }

    mkdirSync(visualsDir, { recursive: true });
    let done = 0;
    const errors = [];
    for (let v = 0; v < total; v++) {
      setState({ state: 'rendering', done, total });
      const { prompt, seed } = variants[v];
      const r = await run(
        process.execPath,
        [join(ROOT, 'engine', 'render-visual.mjs'), '--draft', item.draft, '--option', String(item.option),
          '--seed', String(seed), '--out-dir', visualsDir, '--out-file', `${id}-v${v + 1}.png`],
        { cwd: ROOT, env: { ...process.env, SHIPPOST_RENDER_PROMPT: prompt, SHIPPOST_COMFY_URL: base } }
      );
      if (r.code === 0) done++;
      else {
        errors.push(lastLine(r.stderr) || `render ${v + 1} failed (exit ${r.code})`);
        if (r.code === 2) break; // the engine went away: the next variants would only fail the same way
      }
    }
    setState(errors.length ? { state: 'failed', done, total, error: errors[0] } : { state: 'done', done, total });
    log(`job ${id}: ${done}/${total} images`);
    return errors.length ? 1 : 0;
  } finally {
    release();
  }
}

process.exit(await main());
