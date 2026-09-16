import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.CONTRACT_BASE ?? 'origin/main';
execFileSync('git', ['rev-parse', '--verify', base], { stdio: 'ignore' });
try {
  execFileSync('git', ['cat-file', '-e', `${base}:buf.yaml`], {
    stdio: 'ignore',
  });
} catch {
  // This branch introduces a versioned contract. Legacy rp-proto is intentionally
  // incompatible; once main has v1, every later run compares against it.
  execFileSync('git', ['cat-file', '-e', `${base}:rp-proto/proto/auth.proto`], {
    stdio: 'ignore',
  });
  console.log(
    `Base ${base} has only the legacy 2022 API; v1 is an intentional new contract. Breaking-change enforcement starts with the first v1 baseline.`,
  );
  process.exit(0);
}
const snapshot = await mkdtemp(join(tmpdir(), 'jackpot-contract-base-'));
try {
  const archive = execFileSync('git', [
    'archive',
    base,
    'buf.yaml',
    'packages/contracts/proto',
  ]);
  execFileSync('tar', ['-x', '-C', snapshot], { input: archive });
  execFileSync('buf', ['breaking', '--against', snapshot], {
    stdio: 'inherit',
  });
} finally {
  await rm(snapshot, { recursive: true, force: true });
}
