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
 * When config `video.studioDir` and `video.brandId` are set, a 4th candidate follows the images:
 * <id>-v4.mp4, a 4:5 explainer clip rendered by marketing-studio's Remotion `PostClip`. Its script
 * (hook, points, takeaway) comes from one `claude -p` call on the post, with a no-AI fallback; its
 * ambient track is picked from <studioDir>/studio/public/<brandId>/music/<mood>-N.mp3. Rules in
 * app/lib/clipProps.ts. No ComfyUI.
 *
 * Node >= 22.18 (type stripping): this imports the app's TypeScript directly, like
 * app/scripts/build-carousel.mjs, so the prompt and seed rules live in one tested place.
 *
 * Exit codes: 0 rendered (or nothing to render) · 1 bad input or a failed render.
 */
import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
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

// The child running right now, killed on a signal so a dead parent never leaves an orphan render.
let current = null;
/** Run a child to completion; resolves its exit code and the tail of its stderr. `timeoutMs` kills it. */
function run(cmd, argv, opts, timeoutMs) {
  return new Promise((res) => {
    const child = spawn(cmd, argv, { ...opts, stdio: ['ignore', 'inherit', 'pipe'] });
    current = child;
    let stderr = '';
    const timer = timeoutMs
      ? setTimeout(() => {
          stderr += `\nkilled after ${Math.round(timeoutMs / 60_000)} min without finishing`;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;
    child.stderr.on('data', (c) => {
      process.stderr.write(c);
      stderr = (stderr + c.toString()).slice(-2000);
    });
    const end = (r) => {
      if (timer) clearTimeout(timer);
      if (current === child) current = null;
      res(r);
    };
    child.on('error', (e) => end({ code: null, stderr: String(e) }));
    child.on('close', (code) => end({ code, stderr }));
  });
}
const lastLine = (s) => s.trim().split('\n').filter(Boolean).pop() ?? '';

/** Claude's answer to a one-shot prompt, or '' when it fails (the caller falls back). */
function askClaude(cfg, prompt) {
  const bin = expandTilde(cfg?.engine?.claudeBin || 'claude');
  const argv = ['-p', prompt, ...(cfg?.engine?.model ? ['--model', cfg.engine.model] : [])];
  return new Promise((res) =>
    execFile(bin, argv, { timeout: 180_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) log(`clip script: claude failed (${err.message.split('\n')[0]}), using the post's own sentences`);
      res(err ? '' : stdout);
    })
  );
}

// A Remotion render of a 20 s clip takes well under a minute; past this it is stuck, not slow.
const REMOTION_TIMEOUT_MS = 10 * 60 * 1000;

// Mirrors marketing-studio's studio/src/lib/postClip.ts act table (30 fps).
const CLIP = { hook: 81, image: 81, point: 90, takeaway: 75, end: 93, fps: 30 };

/**
 * The two comment cards, cut from the clip with ffmpeg: the takeaway beat (<id>-card-repost.png,
 * under the author's comment on the repost) and the end card (<id>-card-post.png, under the page's
 * or the post's first comment). Needs <id>.clip.json for the act count. Never fatal: no ffmpeg or
 * no clip means text-only comments.
 */
export async function cutCards({ id, visualsDir, queueDir }) {
  const mp4 = join(visualsDir, `${id}-v4.mp4`);
  let props;
  try {
    props = JSON.parse(readFileSync(join(queueDir, `${id}.clip.json`), 'utf8'));
  } catch {
    return log(`job ${id}: no clip props, no comment cards`);
  }
  if (!existsSync(mp4)) return;
  const takeawayFrom = CLIP.hook + (props.image ? CLIP.image : 0) + CLIP.point * Math.max(1, Math.min(3, props.points?.length ?? 1));
  // 60 frames into each act: the takeaway's underline is drawn, the end card's logo has settled.
  const at = { repost: takeawayFrom + 60, post: takeawayFrom + CLIP.takeaway + 60 };
  for (const [kind, frame] of Object.entries(at)) {
    const out = join(visualsDir, `${id}-card-${kind}.png`);
    const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (frame / CLIP.fps).toFixed(3), '-i', mp4, '-frames:v', '1', out], { cwd: visualsDir, env: process.env }, 60_000);
    if (r.code !== 0) log(`job ${id}: card ${kind} not cut (${lastLine(r.stderr) || `ffmpeg exited ${r.code}`})`);
  }
}

/** Render <id>-v4.mp4 with marketing-studio. Resolves null on success, else the error to show. */
export async function renderClip({ id, item, cfg, studio, visualsDir, queueDir }) {
  const { clipProps, fallbackScript, parseScript, pickTrack, scriptPrompt } = await import(
    pathToFileURL(join(ROOT, 'app', 'lib', 'clipProps.ts')).href
  );
  const brandId = String(cfg.video.brandId);
  // The brand id becomes a directory name under the studio's public dir: only a plain slug goes there.
  if (!/^[a-z0-9-]+$/i.test(brandId)) return `video: video.brandId "${brandId}" is not a plain slug`;
  const studioApp = join(studio, 'studio');
  // The studio's own Remotion, never npx: with node_modules missing, npx would fetch one from the registry.
  const remotion = join(studioApp, 'node_modules', '.bin', 'remotion');
  if (!existsSync(remotion)) return `video: no Remotion in ${studioApp} (run npm install there)`;
  // Remotion only reads images from its public dir, so the first image is copied in for the render.
  const image = [1, 2, 3].map((v) => join(visualsDir, `${id}-v${v}.png`)).find((f) => existsSync(f));
  const shot = image ? `${brandId}/queue/${id}.png` : null;
  // Rendered under a temp name: the queue lists the clip as soon as <id>-v4.mp4 exists.
  const tmp = join(visualsDir, `${id}-v4.tmp.mp4`);
  try {
    if (image) {
      mkdirSync(join(studioApp, 'public', brandId, 'queue'), { recursive: true });
      copyFileSync(image, join(studioApp, 'public', shot));
    }
    let host = '';
    try {
      host = new URL(cfg?.brand?.siteUrl).host;
    } catch {
      /* no site: the brand name closes the clip */
    }
    const kicker = (item.mode === 'company' ? cfg?.brand?.name : cfg?.author?.name) || cfg?.brand?.name || '';
    const answer = await askClaude(cfg, scriptPrompt(item.text));
    const script = parseScript(answer);
    if (!script && answer) log(`clip script: claude's answer was not usable, using the post's own sentences`);
    let tracks = [];
    try {
      tracks = readdirSync(join(studioApp, 'public', brandId, 'music'));
    } catch {
      /* no music folder: a silent clip */
    }
    const track = pickTrack(tracks, item.pillar, id);
    const props = clipProps(script ?? fallbackScript(item), { brandId, kicker, cta: cfg.video.cta || host || cfg?.brand?.name || kicker }, shot, track && `${brandId}/music/${track}`);
    const propsFile = join(queueDir, `${id}.clip.json`);
    writeFileSync(propsFile, JSON.stringify(props));
    const r = await run(remotion, ['render', 'PostClip', tmp, `--props=${propsFile}`], { cwd: studioApp, env: process.env }, REMOTION_TIMEOUT_MS);
    if (r.code !== 0) return `video: ${lastLine(r.stderr) || `remotion exited ${r.code}`}`;
    renameSync(tmp, join(visualsDir, `${id}-v4.mp4`));
    await cutCards({ id, visualsDir, queueDir });
    log(`job ${id}: video rendered (${script ? "claude's script" : 'fallback script'}, ${track ?? 'no music'})`);
    return null;
  } finally {
    // The copied image and a half-written video never outlive the job (the tmp is gone after the rename).
    for (const f of [shot && join(studioApp, 'public', shot), tmp]) {
      if (!f) continue;
      try {
        unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
  }
}

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
  const studio = cfg?.video?.studioDir && cfg?.video?.brandId ? expandTilde(cfg.video.studioDir) : null;
  // ponytail: the clip rides on the image job, so an option with no AI prompt gets no clip either.
  const total = variants.length ? variants.length + (studio ? 1 : 0) : 0;
  if (!total) {
    setState({ state: 'done', done: 0, total: 0 });
    log(`job ${id}: no AI prompt on this option, nothing to render`);
    return 0;
  }

  // Re-runnable: candidates already on disk are kept, so `--job` on an old item only adds what is
  // missing (the video for items queued before it existed, or after a crash).
  const onDisk = () => {
    const missing = variants.map((_, v) => v).filter((v) => !existsSync(join(visualsDir, `${id}-v${v + 1}.png`)));
    const videoDone = Boolean(studio) && existsSync(join(visualsDir, `${id}-v4.mp4`));
    return { missing, videoDone, done: variants.length - missing.length + (videoDone ? 1 : 0) };
  };
  let have = onDisk();
  if (have.done === total) {
    // Clips rendered before the comment cards existed get theirs here (cheap, no lock needed).
    if (have.videoDone && !existsSync(join(visualsDir, `${id}-card-post.png`))) await cutCards({ id, visualsDir, queueDir });
    setState({ state: 'done', done: total, total });
    log(`job ${id}: every candidate is already rendered`);
    return 0;
  }

  // Wait our turn: never two 20 GB model loads at once.
  const waitStart = Date.now();
  let token = acquireLock(lock);
  while (!token) {
    setState({ state: 'waiting', done: have.done, total });
    if (Date.now() - waitStart > MAX_WAIT_MS) {
      setState({ state: 'failed', done: have.done, total, error: 'another render held the image engine for over 2 hours' });
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
  // A killed renderer must not leave a fresh lock that blocks every render for 15 minutes, nor a
  // child still rendering behind the next job.
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'])
    process.on(sig, () => {
      current?.kill('SIGKILL');
      release();
      process.exit(1);
    });

  try {
    // Another run of this same job may have finished while this one waited for the lock: look again.
    have = onDisk();
    let { done } = have;
    const errors = [];
    const base = comfyBaseUrl();
    // An image engine that is down is recorded, and the video (which needs no ComfyUI) still renders.
    let engineOk = true;
    if (have.missing.length && !(await comfyIsUp(base))) {
      if (!canStartLocally(base)) {
        engineOk = false;
        errors.push(`The image engine at ${base} is not answering, and it is not on this machine, so it can't be started from here.`);
      } else {
        setState({ state: 'rendering', done, total, note: 'starting the image engine' });
        const started = await run('bash', [join(ROOT, 'engine', 'comfy-headless.sh')], { cwd: ROOT, env: process.env });
        if (started.code !== 0) {
          engineOk = false;
          const why = started.stderr.split('\n').map((l) => l.trim()).find((l) => l.startsWith('shippost:')) || lastLine(started.stderr);
          errors.push(`Couldn't start the image engine${why ? `: ${why}` : ''}`);
        }
      }
    }

    mkdirSync(visualsDir, { recursive: true });
    for (const v of engineOk ? have.missing : []) {
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
    if (studio && !have.videoDone) {
      setState({ state: 'rendering', done, total, note: 'rendering the video' });
      let err;
      try {
        err = await renderClip({ id, item, cfg, studio, visualsDir, queueDir });
      } catch (e) {
        // A throw still ends in a final state: render.json must never stay at "rendering".
        err = `video: ${(e && e.message) || e}`;
      }
      if (err) errors.push(err);
      else done++;
    }
    setState(errors.length ? { state: 'failed', done, total, error: errors[0] } : { state: 'done', done, total });
    log(`job ${id}: ${done}/${total} candidates${errors.length ? `, ${errors.length} failed` : ''}`);
    return errors.length ? 1 : 0;
  } finally {
    release();
  }
}

// Run only as a script: importing it (for renderClip) must not start a job. Both sides are real
// paths, so a symlinked checkout still runs.
const realPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
if (process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url))) process.exit(await main());
