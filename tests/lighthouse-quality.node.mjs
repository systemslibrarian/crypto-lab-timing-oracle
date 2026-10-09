import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectQuality, validateReports } from '../scripts/lighthouse-quality.mjs';

const names = ['accessibility', 'best-practices', 'performance', 'seo'];
const config = { ci: { collect: { numberOfRuns: 3, staticDistDir: './dist-lh' },
  assert: { assertions: Object.fromEntries(names.map(name => ['categories:' + name,
    [name === 'accessibility' ? 'error' : 'warn', { minScore: name === 'accessibility' ? 1 : 0.9 }]])) },
  upload: { outputDir: '.lighthouseci' } } };
const url = 'http://127.0.0.1:1234/';
const now = Date.now();
const bounds = { url, startedAt: now, finishedAt: now + 5000 };
function report(page = url) {
  return { requestedUrl: page, finalDisplayedUrl: page, finalUrl: page, fetchTime: new Date().toISOString(), categories:
    Object.fromEntries(names.map(name => [name, { score: 1, auditRefs: [{ id: name }] }])),
    audits: Object.fromEntries(names.map(name => [name, { score: 1, scoreDisplayMode: 'binary' }])) };
}
test('all three complete reports pass while advisory scores retain warning severity', () => {
  const reports = [report(), report(), report()];
  reports[1].categories.performance.score = 0.2;
  assert.equal(validateReports(reports, config, bounds).runs, 3);
  assert.equal(validateReports(reports, config, bounds).warnings.length, 1);
  // N/A and manual audits remain distinct from unreadable scored audits.
  reports[0].audits.seo = { score: null, scoreDisplayMode: 'notApplicable' };
  reports[2].audits.accessibility = { score: null, scoreDisplayMode: 'manual' };
  assert.equal(validateReports(reports, config, bounds).runs, 3);
});
test('each unreadable, failed or partial run prevents global success', () => {
  const changes = [r => r.runtimeError = { code: 'NO_FCP' }, r => r.requestedUrl = 'http://wrong.invalid/', r => r.finalDisplayedUrl = 'http://wrong.invalid/',
    r => r.finalUrl = 'http://wrong.invalid/',
    r => r.fetchTime = new Date(now - 60_000).toISOString(), r => r.fetchTime = 'unreadable',
    r => delete r.categories.accessibility, r => r.categories.accessibility.score = null,
    r => r.categories.accessibility.score = 0.99, r => r.categories.accessibility.score = 1.01,
    r => delete r.audits.seo, r => r.audits.accessibility.errorMessage = 'failed gather',
    r => r.categories.performance.auditRefs = [], r => r.audits.seo.score = null,
    r => r.audits.seo.score = NaN, r => r.audits.seo.scoreDisplayMode = 'unreadable'];
  for (let index = 0; index < 3; index++) for (const change of changes) {
    const reports = [report(), report(), report()]; change(reports[index]);
    assert.throws(() => validateReports(reports, config, bounds));
  }
  assert.throws(() => validateReports([report(), report()], config, bounds));
  assert.throws(() => validateReports([report(), report(), report(), report()], config, bounds));
});
test('current orchestration serves actual built input and cannot reuse previous reports', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'lighthouse-controls-'));
  try {
    await mkdir(join(projectRoot, 'dist-lh')); await writeFile(join(projectRoot, 'dist-lh/index.html'), 'CURRENT BUILD');
    await writeFile(join(projectRoot, 'lighthouserc.json'), JSON.stringify(config));
    let invocations = 0;
    const manifest = await collectQuality({ projectRoot, invoke: async ({ url: page, reportPath }) => {
      assert.equal(await (await fetch(page)).text(), 'CURRENT BUILD');
      invocations++; await writeFile(reportPath, JSON.stringify(report(page)));
    } });
    assert.equal(invocations, 3); assert.equal(manifest.status, 'passed');
    // Replace only the subprocess boundary: no Chrome run is claimed here.
    for (const invoke of [async () => { throw new Error('exit73'); }, async () => {},
      async ({ reportPath }) => writeFile(reportPath, '{unreadable')]) {
      await assert.rejects(collectQuality({ projectRoot, invoke }));
    }
    const directories = await readdir(join(projectRoot, '.lighthouseci'));
    const states = await Promise.all(directories.map(async name =>
      JSON.parse(await readFile(join(projectRoot, '.lighthouseci', name, 'manifest.json'), 'utf8')).status));
    assert.equal(states.filter(s => s === 'passed').length, 1);
    assert.equal(states.filter(s => s === 'failed').length, 3);
  } finally { await rm(projectRoot, { recursive: true }); }
});
