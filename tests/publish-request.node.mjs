import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// npm exposes the CLI that launched this script. Do not infer its location from
// process.execPath: Homebrew installs node in a versioned Cellar directory but
// keeps npm in its shared prefix, so that derived path does not exist.
const npmCli = process.env.npm_execpath;

// Replace only the external GitHub boundary; exercise the real npm script.
// Neither control dispatches a workflow or uploads any local build.
function request(exitCode) {
  assert.ok(npmCli, 'npm_execpath is required; run this control through the npm script');
  const dir = mkdtempSync(join(tmpdir(), 'publish-request-control-'));
  const gh = join(dir, 'gh');
  writeFileSync(gh, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(Number(process.env.PUBLISH_CONTROL_EXIT));\n');
  chmodSync(gh, 0o700);
  try {
    return spawnSync(process.execPath, [npmCli, 'run', 'deploy', '--silent'], {
      cwd: root,
      env: { ...process.env, PATH: dir + delimiter + process.env.PATH, GH_TOKEN: '', PUBLISH_CONTROL_EXIT: String(exitCode) },
      encoding: 'utf8',
      timeout: 5000,
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
}

test('publishing requests the existing gated main workflow', () => {
  const result = request(0);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout.trim()), [
    'workflow', 'run', 'deploy.yml', '--repo',
    'systemslibrarian/crypto-lab-timing-oracle', '--ref', 'main',
  ]);
});

test('a rejected publishing request retains its failing exit status', () => {
  const result = request(73);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 73);
});
