import { pathToFileURL } from 'url';
import { loadEnvFile, todayIsoDate } from './lib/env.js';
import {
  ensureLoggedIn,
  withBrowserSession,
} from './lib/browser.js';

loadEnvFile();

const BASE_URL = 'https://wordpress-production-749f.up.railway.app';
const PER_GAME_TIMEOUT_MS = Number(process.env.PER_GAME_TIMEOUT_MS ?? 600000);
const PAGE_OPEN_ATTEMPTS = Number(process.env.PAGE_OPEN_ATTEMPTS ?? 5);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLeague(league) {
  return String(league || 'MLB').toUpperCase();
}

function predictionPageUrl(league) {
  return `${BASE_URL}/?league=${normalizeLeague(league)}&do=1`;
}

async function openPredictionPage(page, league) {
  const pageUrl = predictionPageUrl(league);
  let lastError;

  for (let attempt = 1; attempt <= PAGE_OPEN_ATTEMPTS; attempt++) {
    try {
      log(`Opening ${pageUrl} (attempt ${attempt}/${PAGE_OPEN_ATTEMPTS})`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 180000 });

      if (/wp-login\.php/i.test(page.url()) || (await page.locator('#user_login').count()) > 0) {
        log('Prediction page requires login; refreshing session...');
        await ensureLoggedIn(page);
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 180000 });
      }

      // Prefer NFL/MLB toggle if present
      const leagueToggle = page.getByRole('link', { name: new RegExp(`^${normalizeLeague(league)}$`, 'i') })
        .or(page.locator('a, button, select').filter({ hasText: new RegExp(`^\\s*${normalizeLeague(league)}\\s*$`, 'i') }));
      if ((await leagueToggle.count()) > 0) {
        const toggle = leagueToggle.first();
        const tag = await toggle.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
        if (tag === 'select') {
          await toggle.selectOption({ label: normalizeLeague(league) }).catch(() => {});
        } else {
          await toggle.click().catch(() => {});
          await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
        }
      }

      await page.waitForSelector('table', { timeout: 180000 });
      await page.waitForLoadState('networkidle', { timeout: 180000 }).catch(() => {});
      return;
    } catch (err) {
      lastError = err;
      log(`Open prediction page attempt ${attempt} failed: ${err.message}`);
      if (attempt < PAGE_OPEN_ATTEMPTS) {
        await sleep(15000);
      }
    }
  }
  throw lastError ?? new Error('Failed to open prediction page.');
}

async function rowsNeedingPrediction(page, datePrefix) {
  const rows = page.locator('table tbody tr').filter({
    hasText: new RegExp(datePrefix),
  });
  const count = await rows.count();
  const pending = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = (await row.innerText()).replace(/\s+/g, ' ').trim();
    const hasButton = (await row.getByText(/Generate Prediction/i).count()) > 0;
    if (hasButton) {
      const timeMatch = text.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
      const matchupMatch = text.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(.+?)\s+\d+\s*:\s*\d+/);
      pending.push({
        index: i,
        time: timeMatch?.[0] ?? 'unknown',
        matchup: matchupMatch?.[1]?.trim() ?? text.slice(0, 80),
      });
    }
  }
  return pending;
}

async function clickFirstGenerateForDate(page, datePrefix) {
  const row = page.locator('table tbody tr').filter({
    hasText: new RegExp(datePrefix),
  }).filter({
    has: page.getByText(/Generate Prediction/i),
  }).first();

  await row.waitFor({ state: 'visible', timeout: 30000 });
  const text = (await row.innerText()).replace(/\s+/g, ' ').trim();
  const timeMatch = text.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
  const matchupMatch = text.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(.+?)\s+\d+\s*:\s*\d+/);
  const label = `${timeMatch?.[0] ?? 'unknown'} | ${matchupMatch?.[1]?.trim() ?? 'unknown matchup'}`;

  const button = row.locator('a, button, input').filter({ hasText: /Generate Prediction/i }).first();
  const clickable = (await button.count()) > 0 ? button : row.getByText(/Generate Prediction/i).first();
  await clickable.scrollIntoViewIfNeeded();
  log(`Clicking Generate Prediction for: ${label}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: PER_GAME_TIMEOUT_MS }).catch(() => {}),
    clickable.click(),
  ]);

  await page.waitForLoadState('networkidle', { timeout: PER_GAME_TIMEOUT_MS }).catch(() => {});
  await page.waitForSelector('table', { timeout: 180000 });
  return label;
}

export async function runGeneratePredictions(options = {}) {
  const targetDate = options.targetDate ?? process.env.TARGET_DATE ?? todayIsoDate();
  const league = normalizeLeague(options.league ?? process.env.LEAGUE ?? 'MLB');

  return withBrowserSession(async ({ page }) => {
    let completed = 0;

    await ensureLoggedIn(page);
    await openPredictionPage(page, league);

    let pending = await rowsNeedingPrediction(page, targetDate);
    log(`[${league}] Found ${pending.length} games needing prediction for ${targetDate}`);
    for (const g of pending) {
      log(`  pending: ${g.time} | ${g.matchup}`);
    }

    let guard = 0;
    while (true) {
      pending = await rowsNeedingPrediction(page, targetDate);
      if (pending.length === 0) {
        log(`[${league}] No more Generate Prediction buttons for ${targetDate}.`);
        break;
      }

      guard += 1;
      if (guard > 50) {
        throw new Error('Safety stop: too many iterations.');
      }

      log(`[${league}] Remaining: ${pending.length}`);
      const label = await clickFirstGenerateForDate(page, targetDate);
      completed += 1;
      log(`[${league}] Completed #${completed}: ${label}`);

      const nextBtn = page.locator('table tbody tr').filter({
        hasText: new RegExp(targetDate),
      }).filter({
        has: page.getByText(/Generate Prediction/i),
      }).first();
      if ((await nextBtn.count()) > 0) {
        await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
      }
    }

    log(`[${league}] All done. Generated predictions for ${completed} game(s) on ${targetDate}.`);
    return completed;
  }, options);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runGeneratePredictions().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
