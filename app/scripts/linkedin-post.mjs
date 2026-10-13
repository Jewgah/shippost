#!/usr/bin/env node
/**
 * linkedin-post.mjs - publish ONE queued post to LinkedIn by driving a real (headed) browser.
 *
 * Usage (from app/):
 *   npm run linkedin -- --login                  one-time: log in to LinkedIn in the window that opens
 *   npm run linkedin -- --job <id> [--dry-run]   post one queued item now
 *
 * Nothing is scheduled. POST /api/linkedin {action: "trigger"} (the "Trigger next post" button on
 * /queue) spawns this for the oldest queued item, after setting its chosen image as `asset`.
 * Items are one JSON file each in <draftsDir>/.linkedin/<id>.json (see app/lib/linkedinQueue.ts):
 *   { id, draft, option, topic, mode: "personal"|"company", text, repost,
 *     status: "queued"|"posting"|"posted"|"failed", asset: abs png path|null, error?, createdAt }
 *
 * Company mode publishes on the page, then finds that post and "Repost with your thoughts" as
 * the author, in the same run. The item is marked "posted" BEFORE the repost, so a repost failure
 * can never cause a retry that posts twice. The app records the pick (cadence bar, voice corpus)
 * the next time it lists the queue.
 *
 * The browser profile (LinkedIn session cookies) lives in ~/.shippost/linkedin-profile. Credentials
 * are never stored: --login opens the real login page and you type them yourself.
 *
 * SELECTORS ARE BEST-EFFORT. LinkedIn's DOM changes without notice; everything here targets roles
 * and visible labels rather than class names. On any failure the item is marked "failed" with the
 * message and a screenshot lands at <draftsDir>/.linkedin/<id>.error.png. --dry-run fills the
 * composer and stops before the Post click (screenshot at <id>.dry-run.png).
 *
 * Exit codes: 0 ok · 1 the post failed or bad input · 2 chromium missing · 3 another run holds the lock.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STALE_MS = 15 * 60 * 1000;
const PROFILE_DIR = join(homedir(), '.shippost', 'linkedin-profile');

const expandTilde = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
function loadConfig() {
  const file = process.env.SHIPPOST_CONFIG ? expandTilde(process.env.SHIPPOST_CONFIG) : join(ROOT, 'config.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
const cfg = loadConfig();
const JOBS_DIR = join(expandTilde(cfg.output?.draftsDir ?? '~/Downloads/shippost-drafts'), '.linkedin');
const PAGE_URL = (cfg.brand?.linkedinPageUrl ?? '').replace(/\/?$/, '/');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const dryRun = args.includes('--dry-run');
const log = (...m) => console.log(new Date().toISOString(), ...m);

const jobPath = (id) => join(JOBS_DIR, `${id}.json`);
const readJob = (id) => JSON.parse(readFileSync(jobPath(id), 'utf8'));
function saveJob(job) {
  writeFileSync(jobPath(job.id) + '.tmp', JSON.stringify(job, null, 2));
  renameSync(jobPath(job.id) + '.tmp', jobPath(job.id));
}

// One browser at a time: two processes cannot share a Chrome profile. O_EXCL create, stale after 15 min.
const LOCK = join(JOBS_DIR, '.lock');
function lock() {
  mkdirSync(JOBS_DIR, { recursive: true });
  try {
    if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) unlinkSync(LOCK);
  } catch {
    /* no lock */
  }
  try {
    writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
const unlock = () => {
  try {
    unlinkSync(LOCK);
  } catch {
    /* already gone */
  }
};

async function openBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('playwright is not installed: run npm install in app/');
    process.exit(2);
  }
  mkdirSync(PROFILE_DIR, { recursive: true });
  try {
    // Headed on purpose: LinkedIn challenges headless browsers far more often.
    return await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1280, height: 900 } });
  } catch (e) {
    console.error(`could not start chromium: ${(e && e.message) || e}\nrun: npx playwright install chromium`);
    process.exit(2);
  }
}

const loggedOut = (url) => /\/(login|checkpoint|uas|authwall|signup)/.test(url);

/** Put text into a contenteditable as a paste, so line breaks survive and the OS clipboard is untouched. */
async function pasteInto(editor, text) {
  await editor.click();
  await editor.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  // Fallback: if the editor ignored the synthetic paste, type it (slower, still keeps \n as Enter).
  const got = (await editor.innerText()).trim();
  if (!got) await editor.pressSequentially(text, { delay: 2 });
}

async function attach(page, dialog, file) {
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /add (a )?(photo|media)/i }).first().click();
  await (await chooser).setFiles(file);
  // The image editor step: "Next" (or "Done") returns to the composer.
  const next = page.getByRole('button', { name: /^(next|done)$/i }).first();
  await next.waitFor({ timeout: 30_000 });
  await next.click();
}

/** Open the composer, fill it, and click Post. Returns once LinkedIn closes the dialog. */
async function publish(page, job) {
  if (job.mode === 'company') {
    if (!PAGE_URL || PAGE_URL === '/') throw new Error('brand.linkedinPageUrl is not set in config.json');
    await page.goto(new URL('admin/page-posts/published/', PAGE_URL).href);
  } else {
    await page.goto('https://www.linkedin.com/feed/');
  }
  if (loggedOut(page.url())) throw new Error('not logged in to LinkedIn: run npm run linkedin -- --login');
  await page.getByRole('button', { name: /start a post|create a post|^create$/i }).first().click();
  const dialog = page.getByRole('dialog').last();
  await dialog.waitFor();
  await pasteInto(dialog.locator('[contenteditable="true"]').first(), job.text);
  if (job.asset) await attach(page, dialog, job.asset);
  const post = page.getByRole('dialog').last().getByRole('button', { name: /^post$/i });
  await post.waitFor();
  if (dryRun) return;
  await post.click();
  try {
    await post.waitFor({ state: 'detached', timeout: 120_000 });
  } catch {
    // The click happened: the post may be live. Say so, or a re-add + trigger would post it twice.
    throw new Error('Post was clicked but LinkedIn never closed the composer: check your feed before adding this post again');
  }
}

/** Find the just-published company post on the page and "Repost with your thoughts" as the author. */
async function repost(page, job) {
  const firstLine = job.text.split('\n').find((l) => l.trim()) ?? '';
  const snippet = firstLine.trim().slice(0, 50);
  // A fresh post can take a moment to show on the public feed: reload a few times.
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(new URL('posts/?feedView=all', PAGE_URL).href);
    const card = page.locator('[data-urn*="urn:li:activity"]').filter({ hasText: snippet }).first();
    if (await card.count()) {
      await card.getByRole('button', { name: /^repost/i }).first().click();
      await page.getByText(/repost with your thoughts/i).first().click();
      const dialog = page.getByRole('dialog').last();
      await pasteInto(dialog.locator('[contenteditable="true"]').first(), job.repost);
      const post = dialog.getByRole('button', { name: /^post$/i });
      await post.click();
      await post.waitFor({ state: 'detached', timeout: 60_000 });
      return;
    }
    await page.waitForTimeout(20_000);
  }
  throw new Error(`company post published, but could not find it on the page to repost (looked for "${snippet}")`);
}

async function runJob(ctx, job) {
  log(`job ${job.id}: ${job.mode} post${job.asset ? ' + ' + basename(job.asset) : ''}${dryRun ? ' (dry run)' : ''}`);
  if (job.asset && !existsSync(job.asset)) throw new Error(`asset is gone: ${job.asset}`);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    if (!dryRun) saveJob({ ...job, status: 'posting', startedAt: new Date().toISOString() });
    await publish(page, job);
    if (dryRun) {
      await page.screenshot({ path: join(JOBS_DIR, `${job.id}.dry-run.png`) });
      log(`dry run: composer filled, Post NOT clicked${job.mode === 'company' && job.repost ? '; repost skipped' : ''}`);
      return;
    }
    // Marked posted BEFORE the repost: a repost failure must never cause a retry that posts twice.
    saveJob({ ...job, status: 'posted', postedAt: new Date().toISOString() });
    if (job.mode === 'company' && job.repost?.trim()) {
      await repost(page, job);
      saveJob({ ...readJob(job.id), reposted: true });
    }
    log(`job ${job.id}: done`);
  } catch (e) {
    await page.screenshot({ path: join(JOBS_DIR, `${job.id}.error.png`) }).catch(() => {});
    const posted = readJob(job.id).status === 'posted';
    saveJob({ ...readJob(job.id), status: posted ? 'posted' : 'failed', error: String((e && e.message) || e) });
    throw e;
  }
}

async function main() {
  if (args.includes('--login')) {
    if (!lock()) return process.exit(3);
    const ctx = await openBrowser();
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto('https://www.linkedin.com/login');
      log('log in in the browser window (5 min)...');
      await page.waitForURL(/linkedin\.com\/feed/, { timeout: 5 * 60_000 });
      log('logged in; the session is saved for the next posts');
    } finally {
      await ctx.close();
      unlock();
    }
    return;
  }

  const id = flag('--job');
  if (!id || !/^[\w-]+$/.test(id) || !existsSync(jobPath(id))) {
    console.error(id ? `no such queue item: ${id}` : 'usage: linkedin-post.mjs --login | --job <id> [--dry-run]');
    return process.exit(1);
  }
  // Lock BEFORE reading the item: two runs must never both see it "queued".
  if (!lock()) {
    log('another LinkedIn run is in progress');
    return process.exit(3);
  }
  const job = readJob(id);
  if (job.status !== 'queued' && !dryRun) {
    log(`item ${id} is ${job.status}, not queued: not posting it again`);
    unlock();
    return process.exit(1);
  }

  const ctx = await openBrowser();
  let failed = false;
  try {
    await runJob(ctx, job);
  } catch (e) {
    failed = true;
    log(`item ${id} failed: ${(e && e.message) || e}`);
  } finally {
    await ctx.close();
    unlock();
  }
  process.exit(failed ? 1 : 0);
}

await main();
