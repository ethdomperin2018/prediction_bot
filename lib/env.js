import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function loadEnvFile(cwd = process.cwd()) {
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function todayIsoDate(timeZone = process.env.TZ_NAME ?? 'America/Los_Angeles') {
  // Calendar date in Pacific time (handles PST/PDT)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function requireCredentials() {
  const user = process.env.WP_USER ?? 'attila';
  const pass = process.env.WP_PASS ?? '';
  if (!pass) {
    throw new Error('Missing WP_PASS. Put it in .env or set the environment variable.');
  }
  return { user, pass };
}
