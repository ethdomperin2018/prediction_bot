import { pathToFileURL } from 'url';
import { loadEnvFile } from './lib/env.js';
import { ensureLoggedIn, withBrowserSession } from './lib/browser.js';
import {
  listEndpoints,
  openUpdatePage,
  runOneByOne,
  selectLeagueAndWait,
} from './lib/database-update.js';

loadEnvFile();

// Import each NFL endpoint one at a time.
const NFL_ENDPOINTS = [
  'stadiums',
  'standings',
  'players',
  'teamseason',
  'timeframe',
  'schedule',
  'score',
  'playerseason',
  'bye',
  'injury',
  'rookies',
  'gameinfo',
  'boxscorev3',
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function timeoutFor(endpoint) {
  if (endpoint === 'gameinfo') return 1800000;
  return 600000;
}

export async function runUpdateNfl(options = {}) {
  return withBrowserSession(async ({ page }) => {
    await ensureLoggedIn(page);
    await openUpdatePage(page);
    await selectLeagueAndWait(page, 'nfl');
    log(`Endpoints available: ${(await listEndpoints(page)).join(', ')}`);

    await runOneByOne(page, 'nfl', NFL_ENDPOINTS, timeoutFor);

    log('All NFL database updates completed successfully.');
  }, options);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runUpdateNfl().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
