import { pathToFileURL } from 'url';
import { loadEnvFile, todayIsoDate } from './lib/env.js';
import { runUpdateMlb } from './update-mlb.js';
import { runGeneratePredictions } from './generate-predictions.js';

loadEnvFile();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export async function runBot() {
  const targetDate = process.env.TARGET_DATE ?? todayIsoDate();
  const skipUpdate = process.env.SKIP_UPDATE === '1';
  const skipPredictions = process.env.SKIP_PREDICTIONS === '1';

  log('========== MLB bot starting ==========');
  log(`Target date for predictions: ${targetDate}`);

  if (!skipUpdate) {
    log('----- Part 1/2: Database update -----');
    await runUpdateMlb();
    log('----- Part 1/2 complete -----');
  } else {
    log('Skipping database update (SKIP_UPDATE=1)');
  }

  if (!skipPredictions) {
    log('----- Part 2/2: Generate predictions -----');
    const completed = await runGeneratePredictions({ targetDate });
    log(`----- Part 2/2 complete (${completed} games) -----`);
  } else {
    log('Skipping predictions (SKIP_PREDICTIONS=1)');
  }

  log('========== MLB bot finished ==========');
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runBot().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
