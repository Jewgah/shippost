#!/usr/bin/env node
/**
 * x-post.mjs - publish ONE queued X post (and its thread and link reply) through the X API.
 *
 * Usage (from the repo root):
 *   node app/scripts/x-post.mjs --job <id>              post one queued item now
 *   node app/scripts/x-post.mjs --job <id> --dry-run    print the chain in order, send nothing
 *   node app/scripts/x-post.mjs --check                 prove the keys: GET /2/users/me, print the handle
 *
 * Nothing is scheduled. POST /api/x-queue {action: "trigger"} (the Post button in the X queue)
 * spawns this after setting the picked candidate as `asset`. Items are one JSON file each in
 * <draftsDir>/x/.queue/<id>.json (see app/lib/linkedinQueue.ts):
 *   { id, channel: "x", text, thread: [..], comment, status, asset?, xIds?, url?, error? }
 *
 * Keys: ~/.shippost/x-keys.json = {apiKey, apiSecret, accessToken, accessSecret} (OAuth 1.0a user
 * context, from the X developer portal). The file lives outside the repo; it is read here and
 * nowhere else, and no secret is ever printed or written into an item.
 *
 * The chain: the post (with the uploaded media), then each thread post as a reply to the previous
 * one, then the link reply last. Each new id is saved to `xIds` the moment X returns it, so a run
 * that dies mid-chain never re-posts: a retry (the item set back to queued, ids kept) posts only
 * what is missing. Status after a run:
 *  - posted: `postedAt` and `url` (the first post);
 *  - an X refusal (HTTP error) before the first id: back to queued, nothing went out;
 *  - anything after the first id, or a lost answer to a post request (it may have gone out): failed.
 *
 * Media: the v2 chunked upload (initialize, append, finalize, then STATUS while a video
 * processes). If initialize answers 403 or 404, the v1.1 upload endpoint is tried once instead.
 * Which of the two accepts OAuth 1.0a keys is not verified before the first real post (README).
 *
 * Every HTTP call goes through the global `fetch`. Node >= 22.18 (it imports app/lib/xOauth.ts
 * through type stripping).
 *
 * Exit codes: 0 ok · 1 the post failed or bad input · 2 no X keys · 3 another X run holds the lock.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.x.com/2';
const UPLOAD_V1 = 'https://upload.x.com/1.1/media/upload.json';
const CHUNK = 5 * 1024 * 1024;
const STALE_MS = 15 * 60 * 1000;
// A video that is still processing after this many STATUS polls is reported, not waited on forever.
const MAX_POLLS = 60;

const expandTilde = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const log = (...m) => console.log(new Date().toISOString(), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  const file = process.env.SHIPPOST_CONFIG ? expandTilde(process.env.SHIPPOST_CONFIG) : join(ROOT, 'config.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export const keysPath = () => join(homedir(), '.shippost', 'x-keys.json');
const KEYS_HELP = 'X keys not set: write ~/.shippost/x-keys.json with apiKey, apiSecret, accessToken and accessSecret (see README, X posting)';

/** The four keys, or null when the file is missing or incomplete. Warns when the file is readable by others. */
export function readKeys() {
  const file = keysPath();
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const keys = {};
  for (const k of ['apiKey', 'apiSecret', 'accessToken', 'accessSecret']) {
    if (typeof raw?.[k] !== 'string' || !raw[k].trim()) return null;
    keys[k] = raw[k].trim();
  }
  try {
    if (statSync(file).mode & 0o077) console.error(`warning: ${file} is readable by other users: run chmod 600 on it`);
  } catch {
    /* read above, so it exists */
  }
  return keys;
}

/** X refused the request: carries the HTTP status. Never holds a request header. */
class XHttpError extends Error {
  constructor(status, statusText, body) {
    const detail = [body?.title, body?.detail, body?.errors?.[0]?.message, body?.error].filter((s) => typeof s === 'string' && s).join(': ');
    super(`X answered HTTP ${status}${statusText ? ` ${statusText}` : ''}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}
/** The request may have reached X, but no answer came back. */
class XNetworkError extends Error {}

let oauth1Header;
async function signer() {
  if (!oauth1Header) ({ oauth1Header } = await import(pathToFileURL(join(ROOT, 'app', 'lib', 'xOauth.ts')).href));
  return oauth1Header;
}

/**
 * One signed request. `form` params are form-encoded AND signed; `json` and `multipart` bodies are
 * not signed (RFC 5849). Resolves the parsed JSON answer (or {} for an empty one).
 */
async function xFetch(keys, method, url, { json, form, multipart } = {}) {
  const sign = await signer();
  const headers = { authorization: sign(method, url, form ?? {}, keys) };
  let body;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  } else if (multipart) body = multipart;
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new XNetworkError(`no answer from X (${(e && e.message) || e})`);
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* an empty body */
  }
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!res.ok) throw new XHttpError(res.status, res.statusText, parsed);
  return parsed;
}

// Both answer shapes: v2 nests under `data` (`id`, `processing_info`), v1.1 is flat (`media_id_string`).
const mediaIdOf = (r) => {
  const id = r?.data?.id ?? r?.data?.media_id_string ?? r?.media_id_string ?? r?.data?.media_id ?? r?.media_id;
  if (id === undefined || id === null || id === '') throw new Error('X gave no media id for the upload');
  return String(id);
};
const processingOf = (r) => r?.data?.processing_info ?? r?.processing_info ?? null;

const MEDIA = {
  '.png': ['image/png', 'tweet_image'],
  '.jpg': ['image/jpeg', 'tweet_image'],
  '.jpeg': ['image/jpeg', 'tweet_image'],
  '.webp': ['image/webp', 'tweet_image'],
  '.gif': ['image/gif', 'tweet_gif'],
  '.mp4': ['video/mp4', 'tweet_video'],
};

/** Poll STATUS while X says the media is still processing (a video). Throws when processing failed. */
async function waitProcessed(keys, info, statusUrl) {
  for (let n = 0; info && (info.state === 'pending' || info.state === 'in_progress'); n++) {
    if (n >= MAX_POLLS) throw new Error('X was still processing the video after the last status check: try again later');
    const secs = Number(info.check_after_secs);
    await sleep(Math.min(Number.isFinite(secs) && secs >= 1 ? secs : 1, 30) * 1000);
    info = processingOf(await xFetch(keys, 'GET', statusUrl));
  }
  if (info?.state === 'failed') throw new Error(`X could not process the media: ${info.error?.message || info.error?.name || 'no reason given'}`);
}

/** Chunks of the file, at least one (an append always carries a segment). */
const chunks = (buf) => {
  const out = [];
  for (let off = 0; off < buf.length || out.length === 0; off += CHUNK) out.push(buf.subarray(off, off + CHUNK));
  return out;
};

async function uploadV2(keys, file, buf, mediaType, category) {
  let init;
  try {
    init = await xFetch(keys, 'POST', `${API}/media/upload/initialize`, {
      json: { media_type: mediaType, total_bytes: buf.length, media_category: category },
    });
  } catch (e) {
    // Nothing is uploaded yet: the only point where another endpoint may be tried.
    if (e instanceof XHttpError && (e.status === 403 || e.status === 404)) e.tryV1 = true;
    throw e;
  }
  const id = mediaIdOf(init);
  for (const [segment, part] of chunks(buf).entries()) {
    const fd = new FormData();
    fd.append('segment_index', String(segment));
    fd.append('media', new Blob([part], { type: mediaType }), basename(file));
    await xFetch(keys, 'POST', `${API}/media/upload/${encodeURIComponent(id)}/append`, { multipart: fd });
  }
  const fin = await xFetch(keys, 'POST', `${API}/media/upload/${encodeURIComponent(id)}/finalize`);
  await waitProcessed(keys, processingOf(fin), `${API}/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`);
  return id;
}

async function uploadV1(keys, file, buf, mediaType, category) {
  const init = await xFetch(keys, 'POST', UPLOAD_V1, {
    form: { command: 'INIT', total_bytes: String(buf.length), media_type: mediaType, media_category: category },
  });
  const id = mediaIdOf(init);
  for (const [segment, part] of chunks(buf).entries()) {
    const fd = new FormData();
    fd.append('command', 'APPEND');
    fd.append('media_id', id);
    fd.append('segment_index', String(segment));
    fd.append('media', new Blob([part], { type: mediaType }), basename(file));
    await xFetch(keys, 'POST', UPLOAD_V1, { multipart: fd });
  }
  const fin = await xFetch(keys, 'POST', UPLOAD_V1, { form: { command: 'FINALIZE', media_id: id } });
  await waitProcessed(keys, processingOf(fin), `${UPLOAD_V1}?command=STATUS&media_id=${encodeURIComponent(id)}`);
  return id;
}

/** Upload one file; resolves its media id. */
export async function uploadMedia(keys, file) {
  const kind = MEDIA[extname(file).toLowerCase()];
  if (!kind) throw new Error(`X cannot attach a ${extname(file) || 'file without extension'}: ${basename(file)}`);
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    throw new Error(`the picked candidate is gone: ${basename(file)}`);
  }
  try {
    return await uploadV2(keys, file, buf, ...kind);
  } catch (e) {
    if (!e?.tryV1) throw e;
    log(`v2 media upload answered ${e.status}, trying the v1.1 upload endpoint`);
    return uploadV1(keys, file, buf, ...kind);
  }
}

/** The posts of an item in chain order: the post, the thread, the link reply. Empty ones dropped. */
export const chainOf = (item) =>
  [item.text, ...(Array.isArray(item.thread) ? item.thread : []), item.comment]
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim());

// --- the X lock: one X run at a time (O_EXCL create, stale after 15 min, pid as owner) ---
function lock(dir) {
  const file = join(dir, '.lock');
  mkdirSync(dir, { recursive: true });
  try {
    if (Date.now() - statSync(file).mtimeMs > STALE_MS) unlinkSync(file);
  } catch {
    /* no lock */
  }
  try {
    writeFileSync(file, String(process.pid), { flag: 'wx' });
  } catch {
    return null;
  }
  const beat = setInterval(() => {
    try {
      utimesSync(file, new Date(), new Date());
    } catch {
      /* gone */
    }
  }, 60_000);
  beat.unref();
  return () => {
    clearInterval(beat);
    try {
      if (readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file);
    } catch {
      /* already gone */
    }
  };
}

async function postJob(queueDir, id, keys) {
  const file = join(queueDir, `${id}.json`);
  const save = (item) => {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(item, null, 2));
    renameSync(tmp, file);
  };
  const item = JSON.parse(readFileSync(file, 'utf8'));
  if (item.status !== 'queued') {
    log(`item ${id} is ${item.status}, not queued: not posting it`);
    return 1;
  }
  const chain = chainOf(item);
  const xIds = Array.isArray(item.xIds) ? item.xIds.map(String) : [];
  if (!chain.length) {
    save({ ...item, error: 'this item has no text to post' });
    return 1;
  }
  delete item.error;
  item.status = 'posting';
  item.startedAt = new Date().toISOString();
  item.xIds = xIds;
  save(item);

  // Set when a post request was sent and no answer came back: it may be on X already.
  let lost = false;
  try {
    // The media rides on the first post only, so a retry past it uploads nothing.
    let mediaId = null;
    if (xIds.length === 0 && item.asset) {
      log(`job ${id}: uploading ${basename(item.asset)}`);
      mediaId = await uploadMedia(keys, item.asset);
    }
    for (let n = xIds.length; n < chain.length; n++) {
      const body = { text: chain[n] };
      if (n === 0 && mediaId) body.media = { media_ids: [mediaId] };
      if (n > 0) body.reply = { in_reply_to_tweet_id: xIds[n - 1] };
      let r;
      try {
        r = await xFetch(keys, 'POST', `${API}/tweets`, { json: body });
      } catch (e) {
        // A 5xx or a timeout may come back after X created the post: never treat it as not sent.
        if (e instanceof XNetworkError || (e instanceof XHttpError && (e.status >= 500 || e.status === 408))) lost = true;
        throw e;
      }
      const postId = r?.data?.id;
      if (postId === undefined || postId === null || postId === '') {
        lost = true;
        throw new Error('X accepted the post but returned no id');
      }
      xIds.push(String(postId));
      item.xIds = xIds;
      save(item);
      log(`job ${id}: post ${n + 1}/${chain.length} is ${postId}`);
    }
    save({ ...item, status: 'posted', postedAt: new Date().toISOString(), url: `https://x.com/i/status/${xIds[0]}`, xIds });
    log(`job ${id}: posted https://x.com/i/status/${xIds[0]}`);
    return 0;
  } catch (e) {
    let msg = String((e && e.message) || e);
    if (lost) msg += ': check x.com before retrying, it may have gone out';
    const status = xIds.length === 0 && !lost ? 'queued' : 'failed';
    save({ ...item, status, xIds, error: msg });
    log(`job ${id}: ${status === 'queued' ? 'nothing went out' : `failed after ${xIds.length} of ${chain.length} posts`}: ${msg}`);
    return 1;
  }
}

function dryRun(queueDir, id) {
  const item = JSON.parse(readFileSync(join(queueDir, `${id}.json`), 'utf8'));
  const chain = chainOf(item);
  const done = Array.isArray(item.xIds) ? item.xIds.length : 0;
  console.log(`dry run, nothing is sent. Item ${id} (${item.status}), ${chain.length} posts${done ? `, ${done} already on X` : ''}:`);
  if (item.asset && done === 0) console.log(`  media: ${basename(item.asset)} (uploaded first, attached to post 1)`);
  chain.forEach((t, n) => {
    const where = n === 0 ? 'post' : n === chain.length - 1 && item.comment && t === String(item.comment).trim() ? 'link reply' : `thread ${n + 1}/`;
    console.log(`  ${n + 1}. ${n < done ? '[already posted] ' : ''}${where}: ${t.replace(/\n/g, ' / ')}`);
  });
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const cfg = loadConfig();
  const queueDir = join(expandTilde(cfg?.output?.draftsDir || '~/Downloads/shippost-drafts'), 'x', '.queue');

  if (argv.includes('--check')) {
    const keys = readKeys();
    if (!keys) {
      console.error(KEYS_HELP);
      return 2;
    }
    try {
      const r = await xFetch(keys, 'GET', `${API}/users/me`);
      const name = r?.data?.username;
      if (!name) throw new Error('X answered without a username');
      console.log(`X keys work: @${name}`);
      return 0;
    } catch (e) {
      console.error(`X keys check failed: ${(e && e.message) || e}`);
      return 1;
    }
  }

  const id = flag('--job');
  if (!id || !/^[A-Za-z0-9_-]{1,120}$/.test(id) || !existsSync(join(queueDir, `${id}.json`))) {
    console.error(id ? `no such X queue item: ${id}` : 'usage: x-post.mjs --job <id> [--dry-run] | --check');
    return 1;
  }
  if (argv.includes('--dry-run')) return dryRun(queueDir, id);

  const keys = readKeys();
  if (!keys) {
    console.error(KEYS_HELP);
    return 2;
  }
  // Lock BEFORE reading the item: two runs must never both see it "queued".
  const unlock = lock(queueDir);
  if (!unlock) {
    console.error('another X post run is in progress');
    return 3;
  }
  try {
    return await postJob(queueDir, id, keys);
  } finally {
    unlock();
  }
}

// Run only as a script: importing it (the tests) must not start a job.
const realPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
if (process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url))) process.exit(await main());
