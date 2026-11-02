#!/usr/bin/env node
/**
 * render-visual.mjs - render ONE draft option's "AI prompt" visual with a local ComfyUI.
 *
 * NON-LOAD-BEARING by design: ComfyUI is optional. If it isn't reachable this exits 2 and
 * both callers (engine/generate.sh, app/app/api/render) treat that as "no image this time",
 * never as a failed run.
 *
 * Usage:
 *   node engine/render-visual.mjs --draft 2026-09-06_145923 --option 1 \
 *        [--prompt "…"] [--out-dir DIR] [--seed N] [--out-file NAME.png] [--size WxH]
 *
 *   --prompt   also read from $SHIPPOST_RENDER_PROMPT
 *   --out-dir  also from $SHIPPOST_VISUALS_DIR, else <config output.draftsDir>/.visuals
 *   base URL   $SHIPPOST_COMFY_URL (default http://127.0.0.1:8188)
 *
 *   --out-file a bare file name inside out-dir (engine/render-variants.mjs writes <job>-vN.png)
 *   --size     the PNG's size, default 1080x1350 (LinkedIn's tallest in-feed ratio); the X queue
 *              passes 1600x900 (16:9). The latent is picked by latentFor() below.
 *
 * Writes <out-dir>/<draftId>-o<N>.png (or --out-file) at --size.
 *
 * Model notes (measured on this install, do not "optimize" away):
 *  - flux1-schnell wants 4 steps at cfg 1.0, euler/simple. The negative prompt is required by
 *    the KSampler schema and ignored at cfg 1.0.
 *  - The latent is height/8, so 1350 is not producible exactly: render 1088x1360 (multiples of
 *    16) and downscale.
 *  - fp8 has no compute path on MPS, so the 17 GB checkpoint upcasts to ~20-24 GB resident.
 *    Render ONE image per invocation (batch_size 1) and POST /free afterwards.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
// Docker commonly owns :8000 on a dev machine, and ComfyUI answers /system_stats on whatever
// port it was started with - so probe the one port the engine actually starts (8188), never a list.
const BASE = process.env.SHIPPOST_COMFY_URL || 'http://127.0.0.1:8188';
const POLL_MS = 2000;
// Sized against app/lib/runLock.ts's STALE_MS (15 min): a lock older than that is stealable, and
// a second POST stealing it would start a second 20 GB model load. /api/render now heartbeats the
// `.rendering` lock while it is alive, so ITS budget is no longer capped by this constant - but
// engine/generate.sh takes the same lock and does NOT heartbeat, so this must stay under 15
// minutes for the scheduled path. Measured cold render on an M5 Pro: 77 s.
const TIMEOUT_MS = 12 * 60 * 1000;

export const imagesFromHistory = (history, promptId) =>
  Object.values(history?.[promptId]?.outputs ?? {}).flatMap((node) => node.images ?? []);

/**
 * ComfyUI reports a failed execution in the history entry's status, with empty outputs. Without
 * this the poll loop below would wait out its whole timeout on an error that is already final -
 * and on this machine the most likely error is running out of memory, exactly when holding the
 * render lock for another 12 minutes hurts most.
 */
export const errorFromHistory = (history, promptId) => {
  const status = history?.[promptId]?.status;
  if (!status || status.status_str !== 'error') return null;
  const detail = (status.messages ?? [])
    .filter((m) => Array.isArray(m) && m[0] === 'execution_error')
    .map((m) => m[1]?.exception_message)
    .filter(Boolean)
    .join('; ');
  return detail || 'ComfyUI reported an execution error';
};

/**
 * Build the API graph: parse the workflow FIRST, then assign the prompt and seed as real
 * values. Never string-substitute into JSON text - a prompt containing a double quote or a
 * backslash (both ordinary in an art prompt) would produce an unparseable graph, and the seed
 * has to reach ComfyUI as a JSON number because KSampler's `seed` input is typed INT.
 */
export const buildGraph = (templateText, prompt, seed, latent = null) => {
  const graph = JSON.parse(templateText);
  if (graph['2']?.class_type !== 'CLIPTextEncode' || graph['4']?.class_type !== 'KSampler') {
    throw new Error('workflow template changed shape: node 2 must be CLIPTextEncode, node 4 KSampler');
  }
  graph['2'].inputs.text = String(prompt);
  graph['4'].inputs.seed = Number(seed);
  if (latent) {
    if (graph['3']?.class_type !== 'EmptySD3LatentImage') throw new Error('workflow template changed shape: node 3 must be EmptySD3LatentImage');
    graph['3'].inputs.width = latent[0];
    graph['3'].inputs.height = latent[1];
  }
  return graph;
};

// The template's latent, 1088x1360: the pixel budget every size is rendered at.
const LATENT_AREA = 1088 * 1360;

/**
 * The flux latent for an output of w x h: both sides multiples of 16, the EXACT aspect of the
 * output when such a pair exists (then the nearest one to the template's pixel budget), else the
 * nearest rounding. 1080x1350 gives 1088x1360 (the template's own), 1600x900 gives 1536x864.
 */
export const latentFor = (w, h) => {
  let best = null;
  for (let lw = 256; lw <= 2048; lw += 16) {
    const lh = (lw * h) / w;
    if (!Number.isInteger(lh) || lh % 16 !== 0 || lh < 256 || lh > 2048) continue;
    if (!best || Math.abs(lw * lh - LATENT_AREA) < Math.abs(best[0] * best[1] - LATENT_AREA)) best = [lw, lh];
  }
  if (best) return best;
  const lw = Math.max(256, Math.round(Math.sqrt((LATENT_AREA * w) / h) / 16) * 16);
  return [lw, Math.max(256, Math.round((lw * h) / w / 16) * 16)];
};

/** `--size WxH` as [w, h], or null for anything else (each side 64 to 4096 px). */
export const parseSize = (s) => {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(s ?? ''));
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  return w >= 64 && h >= 64 && w <= 4096 && h <= 4096 ? [w, h] : null;
};

const expandTilde = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** Fallback output dir: the configured drafts dir + /.visuals, so the script works standalone. */
const configuredVisualsDir = () => {
  const cfg = process.env.SHIPPOST_CONFIG ? expandTilde(process.env.SHIPPOST_CONFIG) : join(ROOT, 'config.json');
  try {
    const raw = JSON.parse(readFileSync(cfg, 'utf8'));
    return join(expandTilde(raw?.output?.draftsDir || '~/Downloads/shippost-drafts'), '.visuals');
  } catch {
    return join(expandTilde('~/Downloads/shippost-drafts'), '.visuals');
  }
};

/**
 * The PNG's file name: `<draftId>-o<N>.png` by default, or `outFile` when given. `outFile` must be
 * a bare `*.png` name (no directory part), so a caller can never write outside --out-dir with it.
 * Returns null for an unusable name.
 */
export const outputFileName = (draftId, option, outFile) => {
  if (outFile == null || outFile === '') return `${draftId}-o${option}.png`;
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.png$/.test(outFile) && !outFile.includes('..') ? outFile : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const probe = async () => {
  try {
    const res = await fetch(`${BASE}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * sharp lives in app/node_modules (it ships with Next). engine/ has no node_modules of its own,
 * so resolve it from there explicitly rather than relying on directory walking.
 */
const loadSharp = () => {
  try {
    return createRequire(join(ROOT, 'app', 'package.json'))('sharp');
  } catch {
    return null;
  }
};

export async function renderVisual({ draftId, option, prompt, outDir, seed, outFile, size = [1080, 1350] }) {
  // Fail on a missing resize dependency BEFORE burning a minute of GPU time on an image
  // we could not then size correctly.
  const sharp = loadSharp();
  if (!sharp) {
    console.error('sharp is not installed - run `npm install` in app/ (it ships with Next).');
    return 1;
  }

  if (!(await probe())) {
    console.error(`ComfyUI is not reachable at ${BASE}. Start it with: bash engine/comfy-headless.sh`);
    return 2; // documented "no image this time" code - never a failed run for the callers
  }

  const template = readFileSync(join(HERE, 'workflows', 'linkedin-hero-flux.json'), 'utf8');
  const graph = buildGraph(template, prompt, seed, latentFor(size[0], size[1]));

  let queued = {};
  try {
    queued = await (
      await fetch(`${BASE}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
        signal: AbortSignal.timeout(30_000),
      })
    ).json();
  } catch (e) {
    // A non-JSON body (an HTML error page, a proxy) must read as a clear message, not a stack.
    console.error(`could not queue the render: ${(e && e.message) || e}`);
    return 1;
  }
  if (!queued.prompt_id) {
    console.error(`ComfyUI rejected the graph: ${JSON.stringify(queued).slice(0, 500)}`);
    return 1;
  }
  console.log(`queued ${queued.prompt_id} (${draftId} option ${option}, seed ${seed})`);

  const started = Date.now();
  const deadline = started + TIMEOUT_MS;
  let images = [];
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let failure = null;
    try {
      const history = await (
        await fetch(`${BASE}/history/${queued.prompt_id}`, { signal: AbortSignal.timeout(15_000) })
      ).json();
      images = imagesFromHistory(history, queued.prompt_id);
      failure = errorFromHistory(history, queued.prompt_id);
    } catch {
      /* transient while the model loads - keep polling until the deadline */
    }
    if (images.length > 0) break;
    if (failure) {
      console.error(`ComfyUI failed to render: ${failure}`);
      await freeMemory();
      return 1;
    }
  }
  if (images.length === 0) {
    console.error(`render timed out after ${Math.round(TIMEOUT_MS / 60000)} minutes`);
    await freeMemory();
    return 1;
  }

  const img = images[0];
  const params = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
  const bytes = Buffer.from(
    await (await fetch(`${BASE}/view?${params}`, { signal: AbortSignal.timeout(120_000) })).arrayBuffer()
  );

  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, outputFileName(draftId, option, outFile));
  const tmp = `${dest}.tmp`;
  // The latent in (1088x1360 for the default), --size out. Written tmp-then-rename so a reader never sees a partial PNG.
  const resized = await sharp(bytes).resize(size[0], size[1], { fit: 'cover' }).png().toBuffer();
  writeFileSync(tmp, new Uint8Array(resized));
  renameSync(tmp, dest);

  await freeMemory();
  console.log(`rendered ${dest} (${Math.round(resized.length / 1024)} KB, ${Math.round((Date.now() - started) / 1000)}s)`);
  return 0;
}

/** Ask ComfyUI to drop the checkpoint. Best effort: unified memory is the scarce resource here. */
async function freeMemory() {
  try {
    await fetch(`${BASE}/free`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    /* best effort */
  }
}

const flag = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const draftId = flag(args, '--draft');
  const option = Number(flag(args, '--option'));
  const prompt = (flag(args, '--prompt') ?? process.env.SHIPPOST_RENDER_PROMPT ?? '').trim();
  const outDir = flag(args, '--out-dir') ?? process.env.SHIPPOST_VISUALS_DIR ?? configuredVisualsDir();
  const seedArg = flag(args, '--seed');
  const seed = seedArg ? Number(seedArg) : Math.floor(Math.random() * 2 ** 31);
  const outFile = flag(args, '--out-file');
  const sizeArg = flag(args, '--size');
  const size = sizeArg === null ? [1080, 1350] : parseSize(sizeArg);

  if (!draftId || !/^\d{4}-\d{2}-\d{2}(_(\d{6}|(?=.{1,40}$)(?=.*[a-z])[a-z0-9]+(-[a-z0-9]+)*))?$/ /* mirrors app/lib/draftId.ts: date, date_HHMMSS, or date_<product-slug> */.test(draftId)) {
    console.error('usage: render-visual.mjs --draft <YYYY-MM-DD[_HHMMSS|_slug]> --option <N> [--prompt "…"]');
    process.exit(1);
  }
  if (!Number.isInteger(option) || option < 1 || option > 20) {
    console.error('--option must be an integer between 1 and 20');
    process.exit(1);
  }
  if (!prompt) {
    console.error('no prompt: pass --prompt or set SHIPPOST_RENDER_PROMPT');
    process.exit(1);
  }
  if (outFile !== null && !outputFileName(draftId, option, outFile)) {
    console.error('--out-file must be a bare file name ending in .png');
    process.exit(1);
  }
  if (!size) {
    console.error('--size must be WxH, each side 64 to 4096 (e.g. 1600x900)');
    process.exit(1);
  }
  process.exit(await renderVisual({ draftId, option, prompt, outDir: resolve(outDir), seed, outFile, size }));
}
