import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = 'https://wordpress-production-749f.up.railway.app';
const USER = process.env.WP_USER ?? 'attila';
const PASS = process.env.WP_PASS ?? '';
const DIR = join(process.cwd(), 'screenshots');
mkdirSync(DIR, { recursive: true });

function log(m) {
  console.log(`[${new Date().toISOString()}] ${m}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);

  await page.goto(`${BASE}/wp-login.php`, { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', USER);
  await page.fill('#user_pass', PASS);
  await page.click('#wp-submit');
  await page.waitForURL(/wp-admin/, { timeout: 60000 });
  log('logged in');

  await page.goto(`${BASE}/wp-admin/admin.php?page=database-update`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('#league', { timeout: 60000 });
  log(`initial league=${await page.inputValue('#league')}`);
  let endpoints = await page.locator('table tbody tr td:nth-child(2)').allTextContents();
  log(`initial endpoints: ${JSON.stringify(endpoints.map((t) => t.trim()).filter(Boolean))}`);

  // Select MLB and wait for navigation caused by form submit
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
    page.selectOption('#league', 'mlb'),
  ]);
  log(`after select league=${await page.inputValue('#league')}`);
  log(`url=${page.url()}`);

  // Wait a bit in case content loads slowly
  for (let i = 0; i < 12; i++) {
    endpoints = await page.locator('table tbody tr td:nth-child(2)').allTextContents();
    const cleaned = endpoints.map((t) => t.trim()).filter(Boolean);
    log(`poll ${i}: count=${cleaned.length} endpoints=${JSON.stringify(cleaned)}`);
    if (cleaned.length > 0) break;
    await page.waitForTimeout(5000);
  }

  await page.screenshot({ path: join(DIR, 'probe-mlb.png'), fullPage: true });
  writeFileSync(join(DIR, 'probe-mlb.html'), await page.content(), 'utf8');

  // Try hard refresh while already on MLB
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#league', { timeout: 60000 });
  log(`after reload league=${await page.inputValue('#league')}`);
  endpoints = await page.locator('table tbody tr td:nth-child(2)').allTextContents();
  log(`after reload endpoints: ${JSON.stringify(endpoints.map((t) => t.trim()).filter(Boolean))}`);
  await page.screenshot({ path: join(DIR, 'probe-mlb-reload.png'), fullPage: true });

  // If still empty, try posting league form explicitly
  if (endpoints.filter((t) => t.trim()).length === 0) {
    log('trying explicit POST via page.evaluate');
    await page.evaluate(() => {
      const form = document.getElementById('league-form');
      const select = document.getElementById('league');
      select.value = 'mlb';
      form.submit();
    });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    endpoints = await page.locator('table tbody tr td:nth-child(2)').allTextContents();
    log(`after explicit post: ${JSON.stringify(endpoints.map((t) => t.trim()).filter(Boolean))}`);
    await page.screenshot({ path: join(DIR, 'probe-mlb-post.png'), fullPage: true });
    writeFileSync(join(DIR, 'probe-mlb-post.html'), await page.content(), 'utf8');
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
