import { ensureLoggedIn, withBrowserSession } from './browser.js';

const BASE_URL = 'https://wordpress-production-749f.up.railway.app';
export const UPDATE_URL = `${BASE_URL}/wp-admin/admin.php?page=database-update`;
export const SUCCESS_TEXT = 'Database update completed successfully.';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export async function openUpdatePage(page) {
  log('Opening database update page...');
  await page.goto(UPDATE_URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#league', { timeout: 120000 });
}

export async function selectLeagueAndWait(page, league) {
  const value = String(league).toLowerCase();
  const label = String(league).toUpperCase();
  const current = await page.inputValue('#league');

  if (current === value) {
    const hasStadiums = await page.locator('table tbody tr', { hasText: /^stadiums$/i }).count();
    if (hasStadiums > 0 || (await page.getByText('stadiums', { exact: true }).count()) > 0) {
      log(`Already on ${label} with endpoints loaded.`);
      return;
    }
  }

  log(`Selecting league: ${label} (form will submit)...`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 }),
    page.selectOption('#league', value),
  ]);

  await page.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll('table tbody tr td:nth-child(2)'));
    return cells.some((c) => c.textContent.trim().toLowerCase() === 'stadiums');
  }, { timeout: 180000 });

  const endpoints = await listEndpoints(page);
  log(`${label} endpoints: ${endpoints.join(', ')}`);
}

export async function listEndpoints(page) {
  const endpoints = await page.locator('table tbody tr td:nth-child(2)').allTextContents();
  return endpoints.map((t) => t.trim()).filter(Boolean);
}

export async function uncheckAllEndpointBoxes(page) {
  const boxes = page.locator('table tbody tr input[type="checkbox"]');
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    if (await box.isChecked()) {
      await box.uncheck({ force: true });
    }
  }
}

export async function setCheckbox(page, name) {
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

const BOXSCORE_TIMEOUT_MS = 10 * 60 * 1000;

export function isBoxscoreEndpoint(name) {
  return /boxscore/i.test(String(name));
}

export async function clickImportUpdate(page, timeoutMs = 900000) {
  const button = page.locator('input[type="submit"][value*="Import" i], button:has-text("Import & Update")').first();
  await button.waitFor({ state: 'visible', timeout: 30000 });
  log('Clicking Import & Update...');

  const started = Date.now();
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {}),
    button.click(),
  ]);

  const remaining = timeoutMs - (Date.now() - started);
  if (remaining > 1000) {
    await page.waitForLoadState('networkidle', { timeout: Math.min(remaining, 120000) }).catch(() => {});
  }
}

export async function waitForSuccess(page, timeoutMs = 900000) {
  log('Waiting for success message...');
  const success = page.getByText(SUCCESS_TEXT, { exact: false });
  try {
    await success.last().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (err) {
    if (err?.name === 'TimeoutError') return false;
    throw err;
  }
  const bodyText = await page.locator('body').innerText();
  const idx = bodyText.lastIndexOf(SUCCESS_TEXT);
  log(`Success message found near end of page (index ${idx}).`);
  return true;
}

export async function runBatch(page, league, items, batchName, timeoutMs = 900000, options = {}) {
  const label = String(league).toUpperCase();
  log(`--- Starting ${label} batch: ${batchName} (${items.join(', ')}) ---`);
  await openUpdatePage(page);
  await selectLeagueAndWait(page, league);
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

  const started = Date.now();
  await clickImportUpdate(page, timeoutMs);
  const remaining = Math.max(5000, timeoutMs - (Date.now() - started));
  const found = await waitForSuccess(page, options.continueWithoutSuccess ? remaining : timeoutMs);
  if (!found && options.continueWithoutSuccess) {
    log(`No success message within ${Math.round(timeoutMs / 60000)} min for ${batchName}. Continuing to the next step.`);
    return;
  }
  if (!found) {
    throw new Error(`Success message not found for ${batchName}`);
  }
  log(`--- Completed ${label} batch: ${batchName} ---`);
}

export async function runOneByOne(page, league, endpoints, timeoutFor = () => 600000) {
  const label = String(league).toUpperCase();
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const batchName = `${label.toLowerCase()}-${String(i + 1).padStart(2, '0')}-${endpoint}`;
    const boxscore = isBoxscoreEndpoint(endpoint);
    await runBatch(page, league, [endpoint], batchName, boxscore ? BOXSCORE_TIMEOUT_MS : timeoutFor(endpoint), {
      continueWithoutSuccess: boxscore,
    });
  }
  log(`All ${label} one-by-one database updates completed successfully.`);
}

const STANDARD_CORE = ['stadiums', 'standings', 'players', 'teamseason', 'games', 'playerseason'];

export async function runStandardLeagueUpdate(league, options = {}) {
  const key = String(league).toLowerCase();
  const label = key.toUpperCase();

  return withBrowserSession(async ({ page }) => {
    await ensureLoggedIn(page);
    await openUpdatePage(page);
    await selectLeagueAndWait(page, key);
    log(`Endpoints available: ${(await listEndpoints(page)).join(', ')}`);

    await runBatch(page, key, STANDARD_CORE, `${key}-batch1-core`, 600000);
    await runBatch(page, key, ['gameinfo'], `${key}-batch2-gameinfo`, 600000);
    await runBatch(page, key, ['boxscore'], `${key}-batch3-boxscore`, BOXSCORE_TIMEOUT_MS, {
      continueWithoutSuccess: true,
    });

    log(`All ${label} database updates completed successfully.`);
  }, options);
}
