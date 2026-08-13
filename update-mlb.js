import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { loadEnvFile, requireCredentials } from './lib/env.js';

loadEnvFile();

const BASE_URL = 'https://wordpress-production-749f.up.railway.app';
const LOGIN_URL = `${BASE_URL}/wp-login.php`;
const UPDATE_URL = `${BASE_URL}/wp-admin/admin.php?page=database-update`;

const SUCCESS_TEXT = 'Database update completed successfully.';
const SCREENSHOT_DIR = join(process.cwd(), 'screenshots');

const BATCH_1 = ['stadiums', 'standings', 'teamseason', 'games', 'playerseason'];
const BATCH_2 = ['gameinfo'];
const BATCH_3 = ['boxscore'];

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

async function openUpdatePage(page) {
  log('Opening database update page...');
  await page.goto(UPDATE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#league', { timeout: 60000 });
}

async function selectMlbAndWait(page) {
  const current = await page.inputValue('#league');
  if (current === 'mlb') {
    const hasStadiums = await page.locator('table tbody tr', { hasText: /^stadiums$/i }).count();
    if (hasStadiums > 0 || (await page.getByText('stadiums', { exact: true }).count()) > 0) {
      log('Already on MLB with endpoints loaded.');
      return;
    }
  }

  log('Selecting league: MLB (form will submit)...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 }),
    page.selectOption('#league', 'mlb'),
  ]);

  await page.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll('table tbody tr td:nth-child(2)'));
    return cells.some((c) => c.textContent.trim().toLowerCase() === 'stadiums');
  }, { timeout: 180000 });

  const endpoints = await page.locator('table tbody tr td:nth-child(2)').allTextContents();
  log(`MLB endpoints: ${endpoints.map((t) => t.trim()).filter(Boolean).join(', ')}`);
}

async function listEndpoints(page) {
  const endpoints = await page.locator('table tbody tr td:nth-child(2)').allTextContents();
  return endpoints.map((t) => t.trim()).filter(Boolean);
}

async function uncheckAllEndpointBoxes(page) {
  const boxes = page.locator('table tbody tr input[type="checkbox"]');
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    if (await box.isChecked()) {
      await box.uncheck({ force: true });
    }
  }
}

async function setCheckbox(page, name) {
  const row = page.locator('table tbody tr').filter({
    has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, 'i') }),
  }).first();

  await row.waitFor({ state: 'visible', timeout: 30000 });
  const box = row.locator('input[type="checkbox"]').first();
  if ((await box.count()) === 0) {
    throw new Error(`No checkbox found in row for: ${name}`);
  }
  if (!(await box.isChecked())) {
    await box.check({ force: true });
  }
  log(`Checked: ${name}`);
}

async function clickImportUpdate(page) {
  const button = page.locator('input[type="submit"][value*="Import" i], button:has-text("Import & Update")').first();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  log('Clicking Import & Update...');

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 900000 }).catch(() => {}),
    button.click(),
  ]);

  await page.waitForLoadState('networkidle', { timeout: 900000 }).catch(() => {});
}

async function waitForSuccess(page, timeoutMs = 900000) {
  log('Waiting for success message...');
  const success = page.getByText(SUCCESS_TEXT, { exact: false });
  await success.last().waitFor({ state: 'visible', timeout: timeoutMs });
  const bodyText = await page.locator('body').innerText();
  const idx = bodyText.lastIndexOf(SUCCESS_TEXT);
  log(`Success message found near end of page (index ${idx}).`);
}

async function runBatch(page, items, batchName, timeoutMs = 900000) {
  log(`--- Starting batch: ${batchName} (${items.join(', ')}) ---`);
  await openUpdatePage(page);
  await selectMlbAndWait(page);
  await uncheckAllEndpointBoxes(page);

  for (const item of items) {
    await setCheckbox(page, item);
  }

  const selected = [];
  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const box = row.locator('input[type="checkbox"]').first();
    if ((await box.count()) > 0 && (await box.isChecked())) {
      const name = (await row.locator('td').nth(1).innerText()).trim();
      selected.push(name);
    }
  }
  log(`Selected before import: ${selected.join(', ')}`);

  await screenshot(page, `before-${batchName}`);
  await clickImportUpdate(page);
  await waitForSuccess(page, timeoutMs);
  await screenshot(page, `after-${batchName}`);
  log(`--- Completed batch: ${batchName} ---`);
}

export async function runUpdateMlb() {
  const { user, pass } = requireCredentials();

  ensureDir(SCREENSHOT_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  try {
    await login(page, user, pass);
    await openUpdatePage(page);
    await selectMlbAndWait(page);
    await screenshot(page, 'mlb-ready');
    log(`Endpoints available: ${(await listEndpoints(page)).join(', ')}`);

    await runBatch(page, BATCH_1, 'batch1-core', 600000);
    await runBatch(page, BATCH_2, 'batch2-gameinfo', 600000);
    await runBatch(page, BATCH_3, 'batch3-boxscore', 1800000);

    log('All MLB database updates completed successfully.');
  } catch (err) {
    await screenshot(page, 'error').catch(() => {});
    try {
      writeFileSync(join(SCREENSHOT_DIR, 'error-page.html'), await page.content(), 'utf8');
    } catch {}
    throw err;
  } finally {
    await browser.close();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runUpdateMlb().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
