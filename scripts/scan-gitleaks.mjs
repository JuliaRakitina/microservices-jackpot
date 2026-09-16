import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// Scan a current-tree snapshot, including pending edits. Original history remains
// preserved and contains obsolete secrets; no global allowlist hides new leaks.
const snapshot = await mkdtemp(join(tmpdir(), 'jackpot-secret-scan-'));
try {
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
  for (const file of files) {
    await mkdir(dirname(join(snapshot, file)), { recursive: true });
    try {
      await copyFile(file, join(snapshot, file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${snapshot}:/src:ro`,
      'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f',
      'dir',
      '/src',
      '--redact',
      '--no-banner',
    ],
    { stdio: 'inherit' },
  );
} finally {
  await rm(snapshot, { recursive: true, force: true });
}
