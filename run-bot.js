import { pathToFileURL } from 'url';
import { loadEnvFile, todayIsoDate } from './lib/env.js';
import { createBrowserSession, ensureLoggedIn } from './lib/browser.js';
import { runUpdateMlb } from './update-mlb.js';
import { runUpdateNba } from './update-nba.js';
import { runUpdateNhl } from './update-nhl.js';
import { runUpdateNfl } from './update-nfl.js';
import { runGeneratePredictions } from './generate-predictions.js';

loadEnvFile();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLeague({ page, targetDate, skipUpdate, skipPredictions, name, update, oneByOne = false }) {
  log(`========== ${name} ==========`);
  if (!skipUpdate) {
    log(`----- ${name} Part 1/2: Database update${oneByOne ? ' (one-by-one)' : ''} -----`);
    await update({ page });
    log(`----- ${name} Part 1/2 complete -----`);
    log(`Waiting 20s before ${name} predictions...`);
    await sleep(20000);
  } else {
    log(`Skipping ${name} database update (SKIP_UPDATE=1)`);
  }

  if (!skipPredictions) {
    log(`----- ${name} Part 2/2: Generate predictions -----`);
    const completed = await runGeneratePredictions({ page, targetDate, league: name });
    log(`----- ${name} Part 2/2 complete (${completed} games) -----`);
  } else {
    log(`Skipping ${name} predictions (SKIP_PREDICTIONS=1)`);
  }
  log(`========== ${name} finished ==========`);
}

export async function runBot() {
  const targetDate = process.env.TARGET_DATE ?? todayIsoDate();
  const skipUpdate = process.env.SKIP_UPDATE === '1';
  const skipPredictions = process.env.SKIP_PREDICTIONS === '1';

  const leagues = [
    { name: 'MLB', skip: process.env.SKIP_MLB === '1', update: runUpdateMlb },
    { name: 'NBA', skip: process.env.SKIP_NBA === '1', update: runUpdateNba },
    { name: 'NHL', skip: process.env.SKIP_NHL === '1', update: runUpdateNhl },
    { name: 'NFL', skip: process.env.SKIP_NFL === '1', update: runUpdateNfl, oneByOne: true },
  ];

  log('========== Prediction bot starting ==========');
  log(`Target date for predictions: ${targetDate}`);

  const session = await createBrowserSession();
  const { browser, page } = session;

  try {
    await ensureLoggedIn(page);

    for (const league of leagues) {
      if (league.skip) {
        log(`Skipping ${league.name} (SKIP_${league.name}=1)`);
        continue;
      }
      await runLeague({
        page,
        targetDate,
        skipUpdate,
        skipPredictions,
        name: league.name,
        update: league.update,
        oneByOne: league.oneByOne,
      });
    }

    log('========== Prediction bot finished ==========');
  } finally {
    await browser.close().catch(() => {});
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runBot().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
