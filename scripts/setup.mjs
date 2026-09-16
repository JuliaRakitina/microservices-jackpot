import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const secrets = [
  'JWT_SECRET',
  'INTERNAL_TOKEN',
  'POSTGRES_PASSWORD',
  'AUTH_DB_PASSWORD',
  'USERS_DB_PASSWORD',
  'BETS_DB_PASSWORD',
  'JACKPOT_DB_PASSWORD',
  'BROKER_PASSWORD',
  'DEMO_ADMIN_PASSWORD',
];
const target = new URL('../.env', import.meta.url);
try {
  const existing = parseEnv(await readFile(target, 'utf8'));
  const invalid = secrets.filter(
    (key) => !/^[a-f0-9]{64}$/.test(existing[key] ?? ''),
  );
  if (invalid.length) {
    throw new Error(
      `Existing .env was preserved; missing or invalid generated values: ${invalid.join(', ')}. Move it aside before setup for a fresh database, or repair the configuration without rotating database passwords.`,
    );
  }
  console.log(
    'Existing .env preserved. Generated secrets are already configured.',
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const values = {
    COMPOSE_PROJECT_NAME: 'jackpot-reference',
    GATEWAY_PORT: '3000',
    ...Object.fromEntries(
      secrets.map((key) => [key, randomBytes(32).toString('hex')]),
    ),
    DEMO_ADMIN_EMAIL: 'admin@example.invalid',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
  };
  await writeFile(
    target,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Created .env with random secrets (mode 0600). Keep this file for the lifetime of the local database volumes.',
  );
}
