#!/usr/bin/env node
/**
 * build-carousel.mjs - turn ONE drafted option into a LinkedIn carousel PDF.
 *
 * A LinkedIn "document post" is a PDF: each page becomes a swipeable slide. This renders the
 * option's own post text as N pages of 1080x1350 CSS px with Playwright, using the rendered
 * hero PNG (if there is one) as slide 1's background. Every word is HTML - flux renders text as
 * gibberish, so nothing readable is ever baked into the image.
 *
 * Usage (from app/):
 *   npm run carousel -- 2026-09-06_145923 1
 *   node scripts/build-carousel.mjs --draft 2026-09-06_145923 --option 1 [--out-dir DIR]
 *
 * Writes <draftsDir>/.visuals/<draftId>-o<N>.pdf (and the source .slides.html beside it, so a
 * layout can be inspected in a browser without re-running this).
 *
 * WHY THIS IS CLI-ONLY, AND MUST NOT RUN DURING AN IMAGE RENDER
 * The app never builds a carousel: it only links to one that already exists (see
 * app/app/api/asset/route.ts, which=carousel). A render loads a ~20 GB flux checkpoint into
 * unified memory and the machine already swaps hard while it is resident; adding a chromium
 * process on top is how both jobs get slow. So this refuses to start while the render lock
 * <draftsDir>/.rendering is fresh (exit 3). It deliberately does NOT take that lock: a ~3 s
 * chromium run does not need to block a render, and a CLI killed mid-run would leak the lock
 * the app depends on.
 *
 * Exit codes: 0 ok · 1 bad input or a build failure · 2 chromium missing · 3 a render is running.
 *
 * Node >= 22.18 is required: this imports the app's TypeScript directly (type stripping), which
 * keeps the slide content model in ONE place, tested by the vitest suite. `app/package.json`
 * declares no `type`, so Node warns about that on every run; the `carousel` npm script silences
 * it with --disable-warning. Do NOT "fix" it by adding `"type": "commonjs"` instead - Node then
 * parses the imported .ts as CommonJS and the import fails outright.
 * Playwright is pinned to the 1.60 line because that is the chromium revision (1223) this
 * machine already has cached; a minor bump wants a new browser download.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.features.typescript) {
  console.error(
    `this script imports the app's TypeScript directly and needs Node >= 22.18 (or >= 23.6); this is ${process.version}`
  );
  process.exit(1);
}

const { parseDraft } = await import('../lib/draftParser.ts');
const { slidesFromOption, slidesHtml, parseThemeTokens, FALLBACK_TOKENS, PAGE_W, PAGE_H, MIN_SLIDES } =
  await import('../lib/carousel.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const ROOT = resolve(APP, '..');
// Mirrors app/lib/runLock.ts's STALE_MS. Not imported: runLock.ts is `server-only`, which throws
// outside a Next server bundle.
const STALE_MS = 15 * 60 * 1000;

const expandTilde = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** The repo config, or {} when there is none (the script then uses the documented defaults). */
function loadConfig() {
  const candidates = process.env.SHIPPOST_CONFIG
    ? [expandTilde(process.env.SHIPPOST_CONFIG)]
    : [join(ROOT, 'config.json'), join(ROOT, 'config.example.json')];
  for (const c of candidates) {
    try {
      return JSON.parse(readFileSync(c, 'utf8'));
    } catch {
      /* try the next one */
    }
  }
  return {};
}

const flag = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

async function main() {
  const args = process.argv.slice(2);
  // Positionals are everything that is neither a `--flag` nor the value right after one, so
  // `<draftId> <option>` (the shape the plan's verification uses) and the flag form both work.
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) i++;
    else positional.push(args[i]);
  }
  const draftId = flag(args, '--draft') ?? positional[0] ?? '';
  const option = Number(flag(args, '--option') ?? positional[1]);

  if (!/^\d{4}-\d{2}-\d{2}(_\d{6})?$/.test(draftId)) {
    console.error('usage: build-carousel.mjs <YYYY-MM-DD[_HHMMSS]> <option>   (or --draft … --option …)');
    return 1;
  }
  if (!Number.isInteger(option) || option < 1 || option > 20) {
    console.error('the option must be an integer between 1 and 20');
    return 1;
  }

  const cfg = loadConfig();
  const draftsDir = expandTilde(cfg?.output?.draftsDir || '~/Downloads/shippost-drafts');
  const outDir = resolve(flag(args, '--out-dir') ?? process.env.SHIPPOST_VISUALS_DIR ?? join(draftsDir, '.visuals'));

  const lock = join(draftsDir, '.rendering');
  try {
    if (Date.now() - statSync(lock).mtimeMs < STALE_MS) {
      console.error('an image render is in progress - wait for it to finish (both jobs are memory-hungry)');
      return 3;
    }
  } catch {
    /* no lock: nothing is rendering */
  }

  const draftFile = join(draftsDir, `${draftId}.md`);
  if (!existsSync(draftFile)) {
    console.error(`no draft at ${draftFile}`);
    return 1;
  }
  const draft = parseDraft(readFileSync(draftFile, 'utf8'));
  const opt = draft.options.find((o) => o.n === option);
  if (!opt) {
    console.error(`draft ${draftId} has no option ${option} (found: ${draft.options.map((o) => o.n).join(', ')})`);
    return 1;
  }
  if (!opt.companyPost.trim()) {
    console.error(`option ${option} has no post text to build slides from`);
    return 1;
  }

  // Inlined as a data URI, never a file:// src: a file:// page's subresource access is not
  // something to rely on, and a data URI always paints.
  const heroFile = join(outDir, `${draftId}-o${option}.png`);
  let heroDataUri;
  if (existsSync(heroFile)) {
    heroDataUri = `data:image/png;base64,${readFileSync(heroFile).toString('base64')}`;
  }

  let tokens = FALLBACK_TOKENS;
  try {
    tokens = parseThemeTokens(readFileSync(join(APP, 'styles', 'globals.css'), 'utf8'), cfg?.app?.theme || 'neutral');
  } catch {
    /* keep the fallback palette */
  }

  const { slides, dropped } = slidesFromOption(opt, {
    landingUrl: cfg?.brand?.landingUrl,
    siteUrl: cfg?.brand?.siteUrl,
  });
  if (slides.length < MIN_SLIDES) {
    console.error(
      `option ${option} is ${slides.length} slides long - too short to post as a carousel. ` +
        'A document post wants a hook, a few points and an ask; post it as a plain text post instead.'
    );
    return 1;
  }
  const html = slidesHtml(slides, {
    tokens,
    brandName: cfg?.brand?.name || '',
    authorName: cfg?.author?.name || '',
    topic: opt.topic || '',
    heroDataUri,
  });

  mkdirSync(outDir, { recursive: true });
  const htmlFile = join(outDir, `${draftId}-o${option}.slides.html`);
  writeFileSync(htmlFile, html, 'utf8');

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('playwright is not installed - run `npm install` in app/');
    return 2;
  }

  const dest = join(outDir, `${draftId}-o${option}.pdf`);
  const tmp = `${dest}.tmp`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.error(`could not start chromium: ${(e && e.message) || e}\nrun: npx playwright install chromium`);
    return 2;
  }
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 30_000 });
    // Fonts resolve locally (no webfont is fetched), but a page.pdf() fired before they are
    // ready lays the text out on the fallback metrics and every size bucket becomes a guess.
    await page.evaluate(() => document.fonts.ready.then(() => true));
    // Print crops in silence. The size buckets keep content inside the band by construction;
    // this says so out loud if a freak paragraph ever gets past them.
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('.slide')]
        .map((el, i) => (el.scrollHeight > el.clientHeight ? i + 1 : 0))
        .filter(Boolean)
    );
    if (overflow.length) console.error(`warning: slide(s) ${overflow.join(', ')} overflow and will be cropped`);
    await page.pdf({
      path: tmp,
      width: `${PAGE_W}px`,
      height: `${PAGE_H}px`,
      printBackground: true,
    });
  } catch (e) {
    // Never leave a half-written .tmp behind, and never surface this as an unhandled rejection:
    // the message is the only diagnosis the user gets.
    rmSync(tmp, { force: true });
    console.error(`could not render the PDF: ${(e && e.message) || e}`);
    return 1;
  } finally {
    await browser.close();
  }
  renameSync(tmp, dest);

  console.log(`wrote ${dest} - ${slides.length} slides at ${PAGE_W}x${PAGE_H}`);
  if (dropped) console.log(`note: ${dropped} paragraph(s) past the slide cap were left out`);
  console.log(`source: ${htmlFile}`);
  return 0;
}

process.exit(await main());
