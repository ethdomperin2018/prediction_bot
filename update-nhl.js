import { pathToFileURL } from 'url';
import { loadEnvFile } from './lib/env.js';
import { runStandardLeagueUpdate } from './lib/database-update.js';

loadEnvFile();

export function runUpdateNhl(options = {}) {
  return runStandardLeagueUpdate('nhl', options);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runUpdateNhl().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
