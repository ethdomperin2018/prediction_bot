import { chromium } from 'playwright';
import { requireCredentials, browserLaunchOptions } from './env.js';

const BASE_URL = 'https://wordpress-production-749f.up.railway.app';
const LOGIN_URL = `${BASE_URL}/wp-login.php`;

const LOGIN_ATTEMPTS = Number(process.env.LOGIN_ATTEMPTS ?? 5);
const LOGIN_TIMEOUT_MS = Number(process.env.LOGIN_TIMEOUT_MS ?? 180000);
const LOGIN_RETRY_DELAY_MS = Number(process.env.LOGIN_RETRY_DELAY_MS ?? 15000);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createBrowserSession() {
  const browser = await chromium.launch(browserLaunchOptions());
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  return { browser, context, page, ownsBrowser: true };
}

export async function loginWithRetry(page, username, password, options = {}) {
  const attempts = options.attempts ?? LOGIN_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const delayMs = options.retryDelayMs ?? LOGIN_RETRY_DELAY_MS;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      log(`Logging in (attempt ${attempt}/${attempts})...`);
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

      // Already logged in: wp-login.php redirects to wp-admin and never shows the form.
      const loginForm = page.locator('#user_login');
      const formVisible = await loginForm.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      if (!formVisible) {
        if (/wp-admin/.test(page.url()) || (await page.locator('#wpadminbar').count()) > 0) {
          log('Already logged in; reusing session.');
          return;
        }
        throw new Error('Login form did not appear and session was not already logged in.');
      }

      await page.fill('#user_login', username);
      await page.fill('#user_pass', password);
      await Promise.all([
        page.waitForURL(/wp-admin/, { timeout: timeoutMs }),
        page.click('#wp-submit'),
      ]);
      log('Login successful.');
      return;
    } catch (err) {
      lastError = err;
      log(`Login attempt ${attempt} failed: ${err.message}`);
      if (attempt < attempts) {
        log(`Waiting ${Math.round(delayMs / 1000)}s before retry...`);
        await sleep(delayMs);
      }
    }
  }

  throw lastError ?? new Error('Login failed.');
}

export async function ensureLoggedIn(page) {
  const { user, pass } = requireCredentials();
  const url = page.url();
  const looksLoggedIn = /wp-admin/.test(url) || (await page.locator('#wpadminbar').count()) > 0;
  if (looksLoggedIn) {
    log('Already logged in; reusing session.');
    return;
  }
  await loginWithRetry(page, user, pass);
}

export async function withBrowserSession(fn, options = {}) {
  const shared = options.page
    ? { browser: null, context: options.page.context(), page: options.page, ownsBrowser: false }
    : await createBrowserSession();

  try {
    return await fn(shared);
  } finally {
    if (shared.ownsBrowser && shared.browser) {
      await shared.browser.close().catch(() => {});
    }
  }
}
