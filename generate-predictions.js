import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { loadEnvFile, requireCredentials, todayIsoDate } from './lib/env.js';

loadEnvFile();

const BASE_URL = 'https://wordpress-production-749f.up.railway.app';
const LOGIN_URL = `${BASE_URL}/wp-login.php`;
const PAGE_URL = `${BASE_URL}/?league=MLB&do=1`;
const SCREENSHOT_DIR = join(process.cwd(), 'screenshots');
const PER_GAME_TIMEOUT_MS = Number(process.env.PER_GAME_TIMEOUT_MS ?? 600000);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

async function screenshot(page, name) {
  ensureDir(SCREENSHOT_DIR);
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log(`Screenshot saved: ${path}`);
}

async function login(page, username, password) {
  log('Logging in...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#user_login', username);
  await page.fill('#user_pass', password);
  await page.click('#wp-submit');
  await page.waitForURL(/wp-admin/, { timeout: 60000 });
  log('Login successful.');
}

async function openPredictionPage(page) {
  log(`Opening ${PAGE_URL}`);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('table', { timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
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
  await page.waitForSelector('table', { timeout: 120000 });
  return label;
}

export async function runGeneratePredictions(options = {}) {
  const { user, pass } = requireCredentials();
  const targetDate = options.targetDate ?? process.env.TARGET_DATE ?? todayIsoDate();

  ensureDir(SCREENSHOT_DIR);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);

  let completed = 0;

  try {
    await login(page, user, pass);
    await openPredictionPage(page);
    await screenshot(page, 'predictions-start');

    let pending = await rowsNeedingPrediction(page, targetDate);
    log(`Found ${pending.length} games needing prediction for ${targetDate}`);
    for (const g of pending) {
      log(`  pending: ${g.time} | ${g.matchup}`);
    }

    let guard = 0;
    while (true) {
      pending = await rowsNeedingPrediction(page, targetDate);
      if (pending.length === 0) {
        log(`No more Generate Prediction buttons for ${targetDate}.`);
        break;
      }

      guard += 1;
      if (guard > 50) {
        throw new Error('Safety stop: too many iterations.');
      }

      log(`Remaining: ${pending.length}`);
      const label = await clickFirstGenerateForDate(page, targetDate);
      completed += 1;
      log(`Completed #${completed}: ${label}`);

      const nextBtn = page.locator('table tbody tr').filter({
        hasText: new RegExp(targetDate),
      }).filter({
        has: page.getByText(/Generate Prediction/i),
      }).first();
      if ((await nextBtn.count()) > 0) {
        await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
      }
    }

    await screenshot(page, 'predictions-done');
    log(`All done. Generated predictions for ${completed} game(s) on ${targetDate}.`);
    return completed;
  } catch (err) {
    await screenshot(page, 'predictions-error').catch(() => {});
    try {
      writeFileSync(join(SCREENSHOT_DIR, 'predictions-error.html'), await page.content(), 'utf8');
    } catch {}
    throw err;
  } finally {
    await browser.close();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runGeneratePredictions().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
