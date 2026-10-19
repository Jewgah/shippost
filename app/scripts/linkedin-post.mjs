#!/usr/bin/env node
/**
 * linkedin-post.mjs - publish ONE queued post to LinkedIn by driving a real (headed) browser.
 *
 * Usage (from app/):
 *   npm run linkedin -- --login                  one-time: log in to LinkedIn in the window that opens
 *   npm run linkedin -- --job <id> [--dry-run]   post one queued item now
 *
 * Nothing is scheduled. POST /api/linkedin {action: "trigger"} (the "Trigger next post" button in the
 * queue dropdown in the top bar) spawns this for the oldest queued item, after setting its chosen image as `asset`.
 * Items are one JSON file each in <draftsDir>/.linkedin/<id>.json (see app/lib/linkedinQueue.ts):
 *   { id, draft, option, topic, mode: "personal"|"company", text, repost,
 *     status: "queued"|"posting"|"posted"|"failed", asset: abs png or mp4 path|null, error?, createdAt }
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
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
const BRAND_NAME = cfg.brand?.name ?? '';

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
let beat;
function lock() {
  mkdirSync(JOBS_DIR, { recursive: true });
  try {
    if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) unlinkSync(LOCK);
  } catch {
    /* no lock */
  }
  try {
    writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
    // Refreshed for as long as the run lasts: a slow run (login wait, every fallback) can pass 15 min,
    // and a stale lock would let a second runner into the same Chrome profile.
    beat = setInterval(() => {
      try {
        utimesSync(LOCK, new Date(), new Date());
      } catch {
        /* gone */
      }
    }, 60_000);
    beat.unref();
    return true;
  } catch {
    return false;
  }
}
const unlock = () => {
  clearInterval(beat);
  try {
    // Only our own: after a stale takeover the file belongs to another run.
    if (readFileSync(LOCK, 'utf8') === String(process.pid)) unlinkSync(LOCK);
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
    unlock(); // every caller holds the lock by now: never leave it behind for 15 minutes
    process.exit(2);
  }
  mkdirSync(PROFILE_DIR, { recursive: true });
  try {
    // Headed on purpose: LinkedIn challenges headless browsers far more often.
    // ponytail: SHIPPOST_LINKEDIN_HEADLESS=1 is for dry runs only (checking selectors without a window);
    // real posts stay headed, LinkedIn challenges headless browsers far more often.
    return await chromium.launchPersistentContext(PROFILE_DIR, { headless: dryRun && process.env.SHIPPOST_LINKEDIN_HEADLESS === '1', viewport: { width: 1280, height: 900 } });
  } catch (e) {
    console.error(`could not start chromium: ${(e && e.message) || e}\nrun: npx playwright install chromium`);
    unlock();
    process.exit(2);
  }
}

// Anchored on a path segment, so a page slug that merely starts with "login" or "uas" is not a login wall.
const loggedOut = (url) => /\/(login|checkpoint|uas|authwall|signup)(\/|\?|#|$)/.test(url);

/**
 * Type text into LinkedIn's editor. Measured 2026-10-14: the editor IGNORES a synthetic paste event
 * (it stays empty), but takes keyboard.insertText and real Enter presses. One insertText per line,
 * Enter between lines, so paragraphs and blank lines survive. The OS clipboard is never touched.
 */
async function pasteInto(editor, text, newline = 'Enter') {
  await editor.click();
  const page = editor.page();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press(newline);
  }
  const got = (await editor.innerText()).replace(/\s+/g, '');
  const want = text.replace(/\s+/g, '');
  if (got.length < want.length * 0.9) throw new Error(`the text did not land in the LinkedIn editor (${got.length} of ${want.length} characters)`);
}

const isVideo = (file) => /\.mp4$/i.test(file ?? '');
const VIDEO_TIMEOUT = 5 * 60_000;

async function attach(page, dialog, file) {
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /add (a )?(photo|media)/i }).first().click();
  await (await chooser).setFiles(file);
  // The image editor step: "Next" (or "Done") returns to the composer. A video uploads first, so its
  // button may take minutes to appear (ASSUMED: not yet measured on a real video post).
  const timeout = isVideo(file) ? VIDEO_TIMEOUT : 30_000;
  const next = page.getByRole('button', { name: /^(next|done)$/i }).first();
  await next.waitFor({ timeout });
  await next.click({ timeout });
}

/**
 * LinkedIn opens upsell / onboarding popups (e.g. "Reactivate Premium") over the page. They are
 * dialogs too, so they must be closed first, or they get mistaken for the post composer and
 * block every click. Only dialogs WITHOUT a text box are closed: the composer is never touched.
 */
async function dismissPopups(page) {
  for (let i = 0; i < 3; i++) {
    const popup = page.locator('[role="dialog"]').filter({ hasNot: page.locator('[contenteditable="true"]') }).first();
    if (!(await popup.isVisible().catch(() => false))) return;
    const close = popup.getByRole('button', { name: /^(dismiss|close)|^not now$|^skip$/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

/** The post composer: the dialog that holds a text box, never just "the last dialog". */
const composerOf = (page) => page.locator('[role="dialog"]').filter({ has: page.locator('[contenteditable="true"]') }).last();

/**
 * Open the composer. Measured on the HakolKal admin (2026-10-14): "Create" is a <button role="link">,
 * and it opens a "Create" dialog where "Start a post" is plain text, not a button. On the personal
 * feed, "Start a post" is the button itself. Roles are not trusted: buttons and links both count.
 */
async function openComposer(page) {
  await dismissPopups(page);
  const composer = composerOf(page);
  const opener = page
    .getByRole('button', { name: /^start a post$|^create$/i })
    .or(page.getByRole('link', { name: /^create$/i }))
    .first();
  await opener.click({ timeout: 20_000 });
  // The page admin's "Create" opens a chooser dialog first, where "Start a post" is plain text.
  // isVisible() never waits, so WAIT for whichever shows up first: the composer or the chooser.
  const startPost = page.locator('[role="dialog"]').getByText('Start a post', { exact: true }).first();
  await Promise.race([
    composer.waitFor({ timeout: 15_000 }).catch(() => {}),
    startPost.waitFor({ timeout: 15_000 }).catch(() => {}),
  ]);
  if (!(await composer.isVisible()) && (await startPost.isVisible())) await startPost.click();
  try {
    await composer.waitFor({ timeout: 20_000 });
  } catch {
    throw new Error(`the post composer did not open on ${page.url()} (a LinkedIn popup or a changed page): see the screenshot`);
  }
  return composer;
}

// Set the moment the Post button is clicked. Before it, nothing can have gone out, so a failure
// puts the item back in the queue (keeping its images) instead of marking it failed.
let postClicked = false;

/** Open the composer, fill it, and click Post. Returns once LinkedIn closes the dialog. */
async function publish(page, job) {
  if (job.mode === 'company' && (!PAGE_URL || PAGE_URL === '/')) throw new Error('brand.linkedinPageUrl is not set in config.json');
  // The admin dashboard is the page address Jordan uses; `admin/page-posts/published/` redirected to
  // the personal feed (2026-10-14), and posting from there would post as the person, not the page.
  const start = job.mode === 'company' ? new URL('admin/dashboard/', PAGE_URL).href : 'https://www.linkedin.com/feed/';
  await page.goto(start);
  if (loggedOut(page.url())) {
    // First run (or an expired session): keep this window open on the login page, wait for the
    // user to log in by hand, then carry on with the post. Nothing is posted before that.
    log('not logged in: waiting up to 5 min for you to log in in the browser window');
    await page.goto('https://www.linkedin.com/login');
    await page.waitForURL((u) => !loggedOut(u.href) && /linkedin\.com\//.test(u.href), { timeout: 5 * 60_000 }).catch((e) => {
      throw new Error(
        /timeout/i.test(String(e))
          ? 'not logged in to LinkedIn (the login window waited 5 min): trigger again and log in when the window opens'
          : `not logged in to LinkedIn: the login window closed before the login finished (${(e && e.message) || e})`
      );
    });
    await page.goto(start);
    if (loggedOut(page.url())) throw new Error('still not logged in to LinkedIn after the login window');
  }
  if (job.mode === 'company' && !/\/company\/[^/]+\/admin/.test(page.url()))
    throw new Error(`LinkedIn did not open the company page admin (it went to ${page.url()}): check brand.linkedinPageUrl and that this account is a page admin`);
  // The posts already listed with the same first line (an earlier attempt at this draft): the
  // fallback confirmation below only accepts a NEW one. `admin/page-posts/published/` redirected to
  // the personal feed (2026-10-14), so the page's list is its dashboard, like the dry run's.
  const listUrl = job.mode === 'company' ? start : MY_ACTIVITY;
  const before = dryRun ? [] : await urnsOn(page, listUrl, snippetOf(job.text));
  if (listUrl !== start) await page.goto(start);
  const dialog = await openComposer(page);
  // Image FIRST: attaching it after the text wiped the text (measured 2026-10-14, 0 characters left).
  if (job.asset) await attach(page, dialog, job.asset);
  await pasteInto(composerOf(page).locator('[contenteditable="true"]').first(), job.text);
  const post = composerOf(page).getByRole('button', { name: /^post$/i });
  await post.waitFor();
  if (dryRun) return null;
  // A video keeps Post disabled while it uploads; click() waits for it to enable. ASSUMED, not yet
  // measured on a real video post: 5 min covers a 20 s clip of a few MB. A click that times out
  // never happened, so postClicked stays false and the item goes back to the queue.
  await post.click(isVideo(job.asset) ? { timeout: VIDEO_TIMEOUT } : undefined);
  postClicked = true;
  // "The Post button disappeared" is NOT proof (2026-10-14: the composer closed, the runner moved on
  // to the repost at once, and the post never appeared; leaving the page mid-publish is the likely
  // cause). Confirm before anything navigates away, and get the post's urn while at it.
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(JOBS_DIR, `${job.id}.after-post.png`) }).catch(() => {});
  const urn = await confirmPublished(page, job.text, listUrl, before);
  if (!urn) throw new Error('Post was clicked but LinkedIn did not confirm it (no confirmation, and not on the page after about 2 minutes): check LinkedIn before posting it again');
  return urn;
}

// "shares", not "all": on Jordan's account `all` shows "Nothing to see for now" while `shares` lists
// every post and repost with its data-urn (measured 2026-10-15, after a real repost).
const MY_ACTIVITY = 'https://www.linkedin.com/in/me/recent-activity/shares/';
const URN_RE = /urn:li:(?:activity|share|ugcPost):\d+/;
const snippetOf = (text) => (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 50);

/**
 * Wait for LinkedIn to confirm a post or repost, and return its urn (null = not confirmed).
 * First its own toast, which usually carries a "View post" link with the urn (up to 60 s; the page
 * is left alone meanwhile, so an upload in flight is never cut). Then, as a fallback, the list it
 * should now be in, matched on its first line, reloaded a few times.
 */
async function confirmPublished(page, text, listUrl, before = []) {
  const viewPost = page.getByRole('link', { name: /view post/i }).first();
  const toast = page.getByText(/post successful|repost successful|successfully (posted|shared|reposted)|your post (is|was) (live|shared|posted)/i).first();
  await Promise.race([viewPost.waitFor({ timeout: 60_000 }).catch(() => {}), toast.waitFor({ timeout: 60_000 }).catch(() => {})]);
  const href = await viewPost.getAttribute('href', { timeout: 2000 }).catch(() => null);
  const m = href && decodeURIComponent(href).match(URN_RE);
  if (m) return m[0];
  return findUrn(page, listUrl, snippetOf(text), 5, before);
}

/** The urns of the post cards on `listUrl` containing `snippet` (all of them when it is empty), top first. */
async function urnsOn(page, listUrl, snippet) {
  await page.goto(listUrl);
  await dismissPopups(page);
  const cards = page.locator('[data-urn*="urn:li:activity"]');
  await cards.first().waitFor({ timeout: 15_000 }).catch(() => {});
  return (snippet ? cards.filter({ hasText: snippet }) : cards).evaluateAll((els) => els.map((e) => e.getAttribute('data-urn')));
}

/** The first of those urns that is not in `before` (null = none after `tries`). */
async function findUrn(page, listUrl, snippet, tries, before = []) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const urn = (await urnsOn(page, listUrl, snippet)).find((u) => !before.includes(u));
    if (urn) return urn;
    if (attempt < tries - 1) await page.waitForTimeout(15_000);
  }
  return null;
}

/**
 * Choose who comments, reacts and reposts on the open post page. Measured 2026-10-14: the avatar
 * next to Like is [aria-label="Switch to different account"]; it opens "Comment, react, and repost
 * as" with one radio per identity (the member first, then each page) and Save. name = null picks
 * the member (the first one). A dry run looks, then cancels.
 */
async function actAs(page, name) {
  const sw = page.locator('[aria-label="Switch to different account"]').first();
  // No switch at all means no page to act as: the member is the only identity.
  if (!name && !(await sw.waitFor({ timeout: 5000 }).then(() => true, () => false))) return;
  await sw.click();
  // Like the repost editor, this modal has no dialog role: find it by its title, then its box.
  const dlg = page.getByText(/^comment, react, and repost as$/i).first().locator('xpath=ancestor::*[.//button[normalize-space()="Save"]][1]');
  await dlg.waitFor({ timeout: 15_000 });
  const option = name
    ? dlg.getByText(new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')).first()
    : dlg.locator('li, [role="radio"], label').first();
  await option.click();
  const save = dlg.getByRole('button', { name: /^save$/i });
  if (!dryRun && (await save.isEnabled().catch(() => false))) await save.click();
  else await dlg.getByRole('button', { name: /^cancel$/i }).click().catch(() => page.keyboard.press('Escape'));
  await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
}

/**
 * Comment on the post `urn`, as the page `asPage` (its display name) or as the member (null).
 * Measured: the box is the textbox "Text editor for creating comment"; once it holds text, its
 * submit is a "Comment" button next to "Share photo". Enter would submit, so new lines are Shift+Enter.
 */
async function commentOn(page, urn, text, asPage, label) {
  await page.goto(`https://www.linkedin.com/feed/update/${urn}/`);
  await dismissPopups(page);
  // Always set, never assumed: LinkedIn remembers the last identity chosen on a post.
  await actAs(page, asPage);
  try {
    const box = page.getByRole('textbox', { name: /text editor for creating comment/i }).first();
    await box.waitFor({ timeout: 15_000 });
    await pasteInto(box, text, 'Shift+Enter');
    const submit = box.locator('xpath=ancestor::*[.//button[@aria-label="Share photo"]][1]').getByRole('button', { name: /^comment$/i }).last();
    await submit.waitFor({ timeout: 15_000 });
    if (dryRun) {
      await page.screenshot({ path: join(JOBS_DIR, `${label}.dry-run-comment.png`) });
      log(`dry run: comment typed on ${urn}${asPage ? ` (as ${asPage}, switch cancelled)` : ''}, NOT sent`);
      return;
    }
    await submit.click(); // waits for it to be enabled (it greys out while a link preview loads)
    // Confirmed when LinkedIn empties the box, which it only does once the comment is sent. ("The
    // text shows on the page" would pass at once: it is still showing in the box itself.) A box
    // that cannot be read is "not confirmed", never "sent".
    const deadline = Date.now() + 30_000;
    for (;;) {
      const left = await box.innerText().catch(() => null);
      if (left !== null && !left.trim()) break;
      if (Date.now() > deadline) throw new Error(`the comment on ${urn} was not confirmed (still in the box, or no box, after 30 s)`);
      await page.waitForTimeout(500);
    }
  } finally {
    // Back to the member even when the comment failed: the repost and its comment must never go out as the page.
    if (asPage) await actAs(page, null).catch((e) => log(`could not switch back to the member on ${urn}: ${(e && e.message) || e}`));
  }
}

/**
 * Repost the company post `urn` on the author's own profile, "with thoughts" (the caption). Measured
 * on the HakolKal page (2026-10-14): on /feed/update/<urn>/ you act as yourself; "Repost" opens a
 * menu of "Repost with thoughts" and "Repost instantly", and only the first is ever clicked (the
 * regex cannot match "instantly"); the "with thoughts" editor is a modal with NO dialog role, and
 * its button is "Repost". Returns the repost's own urn (null if it could not be confirmed).
 * Dry run (urn = null): rehearses on the latest page post and stops before the final click.
 */
async function repost(page, job, urn) {
  if (!urn) urn = await findUrn(page, new URL('admin/dashboard/', PAGE_URL).href, null, 1);
  if (!urn) throw new Error('found no page post to repost');
  // Earlier reposts with the same caption: the confirmation below only accepts a new one.
  const before = dryRun ? [] : await urnsOn(page, MY_ACTIVITY, snippetOf(job.repost));
  await page.goto(`https://www.linkedin.com/feed/update/${urn}/`);
  await dismissPopups(page);
  await actAs(page, null); // the repost is the member's, whatever identity was last used on this post
  await page.getByRole('button', { name: /^repost$/i }).first().click();
  await page.getByText(/^repost with (your )?thoughts$/i).first().click();
  const editor = page.locator('[contenteditable="true"]').filter({ visible: true }).last();
  await editor.waitFor({ timeout: 15_000 });
  await pasteInto(editor, job.repost);
  // The modal's own Repost button: the nearest ancestor of the editor that holds one (the post's
  // action-bar "Repost" sits outside the modal).
  const go = editor.locator('xpath=ancestor::*[.//button[normalize-space()="Repost"]][1]').getByRole('button', { name: /^repost$/i }).last();
  await go.waitFor({ timeout: 15_000 });
  if (dryRun) {
    await page.screenshot({ path: join(JOBS_DIR, `${job.id}.dry-run-repost.png`) });
    log(`dry run: repost editor filled on ${urn}, Repost NOT clicked`);
    return urn;
  }
  await go.click();
  await page.waitForTimeout(3000);
  return confirmPublished(page, job.repost, MY_ACTIVITY, before);
}

async function runJob(ctx, job) {
  log(`job ${job.id}: ${job.mode} post${job.asset ? ' + ' + basename(job.asset) : ''}${dryRun ? ' (dry run)' : ''}`);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    if (!dryRun) {
      // Re-read right before claiming it: "Remove" may have deleted the item (or a second trigger
      // changed it) while the browser was starting. Writing "posting" from the in-memory copy
      // would recreate a removed item and post it anyway.
      if (!existsSync(jobPath(job.id))) {
        log(`item ${job.id} was removed before posting started: not posting it`);
        return;
      }
      const fresh = readJob(job.id);
      if (fresh.status !== 'queued') {
        log(`item ${job.id} is ${fresh.status} now, not queued: not posting it`);
        return;
      }
      saveJob({ ...fresh, status: 'posting', startedAt: new Date().toISOString() });
    }
    // Inside the try, so a missing image is recorded on the item (and it goes back to the queue).
    if (job.asset && !existsSync(job.asset)) throw new Error(`asset is gone: ${job.asset}`);
    // Without a name the page comment would go out as the member while the log said the page.
    if (job.mode === 'company' && job.comment?.trim() && !BRAND_NAME) throw new Error('brand.name is not set in config.json: the first comment cannot go out as the page');
    const urn = await publish(page, job);
    const company = job.mode === 'company';
    if (dryRun) {
      const typed = (await composerOf(page).locator('[contenteditable="true"]').first().innerText().catch(() => '')).trim();
      log(`dry run: ${typed.length} characters in the editor (the post has ${job.text.trim().length})`);
      await page.screenshot({ path: join(JOBS_DIR, `${job.id}.dry-run.png`) });
      log('dry run: composer filled, Post NOT clicked');
      const rehearsal = company && job.repost?.trim() ? await repost(page, job, null) : null;
      if (job.comment?.trim()) {
        // On the latest post of the right list, so personal mode rehearses its comment too.
        const target = rehearsal ?? (await findUrn(page, company ? new URL('admin/dashboard/', PAGE_URL).href : MY_ACTIVITY, null, 1));
        if (target) await commentOn(page, target, job.comment, company ? BRAND_NAME : null, job.id);
        else log('dry run: found no post to rehearse the comment on');
      }
      return;
    }
    // Marked posted (confirmed) BEFORE the follow-ups: a later failure must never cause a retry
    // that posts twice. Each follow-up records its own flag, so the item shows what got done.
    saveJob({ ...readJob(job.id), status: 'posted', postedAt: new Date().toISOString(), urn });
    log(`job ${job.id}: posted ${urn}`);
    // Each follow-up runs even when another failed (the page comment does not need the repost).
    // Failures are collected and recorded on the item at the end, step by step.
    const failures = [];
    const step = async (what, fn) => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${what}: ${(e && e.message) || e}`);
        log(`job ${job.id}: ${what} failed: ${(e && e.message) || e}`);
      }
    };
    let repostUrn = null;
    if (company && job.repost?.trim())
      await step('repost', async () => {
        repostUrn = await repost(page, job, urn);
        saveJob({ ...readJob(job.id), reposted: true, repostUrn });
        log(`job ${job.id}: reposted${repostUrn ? ` ${repostUrn}` : ' (not confirmed)'}`);
      });
    if (job.comment?.trim()) {
      await step(company ? 'comment on the page post' : 'first comment', async () => {
        await commentOn(page, urn, job.comment, company ? BRAND_NAME : null, job.id);
        saveJob({ ...readJob(job.id), commented: true });
        log(`job ${job.id}: first comment posted${company ? ` as ${BRAND_NAME}` : ''}`);
      });
      if (company && job.repost?.trim())
        await step('comment on the repost', async () => {
          if (!repostUrn) throw new Error('the repost was not found on your profile, so it was not commented: add the comment by hand');
          await commentOn(page, repostUrn, job.comment, null, job.id);
          saveJob({ ...readJob(job.id), repostCommented: true });
          log(`job ${job.id}: comment posted on the repost`);
        });
    }
    if (failures.length) throw new Error(failures.join(' | '));
    log(`job ${job.id}: done`);
  } catch (e) {
    await page.screenshot({ path: join(JOBS_DIR, `${job.id}.error.png`) }).catch(() => {});
    if (dryRun) throw e; // a rehearsal never touches the item
    const posted = readJob(job.id).status === 'posted';
    const status = posted ? 'posted' : postClicked ? 'failed' : 'queued';
    saveJob({ ...readJob(job.id), status, error: String((e && e.message) || e) });
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
    } catch (e) {
      log(`login not finished: ${(e && e.message) || e}`);
      process.exitCode = 1;
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
