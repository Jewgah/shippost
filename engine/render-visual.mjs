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
 *        [--prompt "…"] [--out-dir DIR] [--seed N]
 *
 *   --prompt   also read from $SHIPPOST_RENDER_PROMPT
 *   --out-dir  also from $SHIPPOST_VISUALS_DIR, else <config output.draftsDir>/.visuals
 *   base URL   $SHIPPOST_COMFY_URL (default http://127.0.0.1:8188)
 *
 * Writes <out-dir>/<draftId>-o<N>.png at 1080x1350 (LinkedIn's tallest in-feed ratio).
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
// Must stay UNDER app/lib/runLock.ts's STALE_MS (15 min): /api/render holds the `.rendering`
// lock for the child's lifetime, and a lock older than STALE_MS is stealable - a longer render
// than that would let a second POST start a second 20 GB model load. Measured cold render on
// an M5 Pro: 77 s.
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
export const buildGraph = (templateText, prompt, seed) => {
  const graph = JSON.parse(templateText);
  if (graph['2']?.class_type !== 'CLIPTextEncode' || graph['4']?.class_type !== 'KSampler') {
    throw new Error('workflow template changed shape: node 2 must be CLIPTextEncode, node 4 KSampler');
  }
  graph['2'].inputs.text = String(prompt);
  graph['4'].inputs.seed = Number(seed);
  return graph;
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

export async function renderVisual({ draftId, option, prompt, outDir, seed }) {
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
  const graph = buildGraph(template, prompt, seed);

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
  const dest = join(outDir, `${draftId}-o${option}.png`);
  const tmp = `${dest}.tmp`;
  // 1088x1360 in, 1080x1350 out. Written tmp-then-rename so a reader never sees a partial PNG.
  const resized = await sharp(bytes).resize(1080, 1350, { fit: 'cover' }).png().toBuffer();
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

  if (!draftId || !/^\d{4}-\d{2}-\d{2}(_\d{6})?$/.test(draftId)) {
    console.error('usage: render-visual.mjs --draft <YYYY-MM-DD[_HHMMSS]> --option <N> [--prompt "…"]');
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
  process.exit(await renderVisual({ draftId, option, prompt, outDir: resolve(outDir), seed }));
}
