import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Location-only checks: never print a matched credential or file contents.
const patterns = [
  [
    'JWT literal',
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  ],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['cloud access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  [
    'credential URL',
    /(?:postgres(?:ql)?|amqps?|mongodb(?:\+srv)?):\/\/[^\s/:]+:[a-zA-Z0-9]{16,}@/g,
  ],
  [
    'literal secret',
    /\b(?:JWT_SECRET|INTERNAL_TOKEN|POSTGRES_PASSWORD|AUTH_DB_PASSWORD|USERS_DB_PASSWORD|BETS_DB_PASSWORD|JACKPOT_DB_PASSWORD|BROKER_PASSWORD)\s*[=:]\s*["']?[a-f0-9]{32,}/g,
  ],
];
const files = [
  ...new Set(
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean),
  ),
];
let findings = 0;
for (const file of files) {
  if (/\.(?:png|jpe?g|gif|pdf|zip|woff2?)$/i.test(file)) continue;
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  for (const [label, pattern] of patterns) {
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split('\n').length;
      console.error(`${file}:${line}: ${label} (value withheld)`);
      findings++;
    }
  }
}
if (findings) {
  console.error(
    `Secret scan failed: ${findings} possible credential literals.`,
  );
  process.exitCode = 1;
} else
  console.log(
    `Secret scan passed (${files.length} tracked/non-ignored paths; heuristic current-tree check).`,
  );
