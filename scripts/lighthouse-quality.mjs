import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const categories = ['accessibility', 'best-practices', 'performance', 'seo'];

export function validateReports(reports, config, { url, startedAt, finishedAt }) {
  const count = config.ci.collect.numberOfRuns;
  if (!Number.isInteger(count) || count < 1 || reports.length !== count) {
    throw new Error('Missing or unexpected Lighthouse runs');
  }
  const warnings = [];
  for (const [index, report] of reports.entries()) {
    const fetched = Date.parse(report?.fetchTime);
    if (report?.runtimeError || report?.requestedUrl !== url || report?.finalDisplayedUrl !== url || report?.finalUrl !== url || !Number.isFinite(fetched)
      || fetched < startedAt - 10_000 || fetched > finishedAt + 10_000) {
      throw new Error(`Run ${index + 1}: failed, stale, unreadable or wrong-page audit`);
    }
    for (const name of categories) {
      const category = report.categories?.[name];
      const assertion = config.ci.assert.assertions['categories:' + name];
      if (!category || !Number.isFinite(category.score) || category.score < 0 || category.score > 1
        || !Array.isArray(category.auditRefs) || !category.auditRefs.length
        || !Array.isArray(assertion) || !['error', 'warn'].includes(assertion[0])
        || !Number.isFinite(assertion[1]?.minScore) || assertion[1].minScore < 0 || assertion[1].minScore > 1) {
        throw new Error(`Run ${index + 1}: missing category, score, audits or assertion for ${name}`);
      }
      for (const reference of category.auditRefs) {
        const audit = report.audits?.[reference.id];
        if (!audit || audit.errorMessage || !['binary', 'numeric', 'metricSavings', 'manual', 'informative', 'notApplicable'].includes(audit.scoreDisplayMode)
          || (['binary', 'numeric', 'metricSavings'].includes(audit.scoreDisplayMode)
            && (!Number.isFinite(audit.score) || audit.score < 0 || audit.score > 1))) {
          throw new Error(`Run ${index + 1}: missing or failed audit ${reference.id}`);
        }
      }
      if (category.score < assertion[1].minScore) {
        const message = `Run ${index + 1}: ${name} ${category.score} < ${assertion[1].minScore}`;
        if (assertion[0] === 'error') throw new Error(message);
        warnings.push(message);
      }
    }
  }
  return { runs: reports.length, warnings };
}

function runCli({ url, reportPath }) {
  return new Promise((accept, reject) => {
    const cli = resolve(root, 'node_modules/lighthouse/cli/index.js');
    const child = spawn(process.execPath, [cli, url, '--output=json', '--output-path=' + reportPath,
      '--chrome-flags=--headless --disable-dev-shm-usage', '--verbose'], {
      env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath() },
      stdio: ['ignore', 'inherit', 'inherit'], timeout: 120_000,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? accept()
      : reject(new Error(`Lighthouse exited ${code ?? signal}`)));
  });
}

export async function collectQuality({ projectRoot = root, invoke = runCli } = {}) {
  const config = JSON.parse(await readFile(resolve(projectRoot, 'lighthouserc.json'), 'utf8'));
  const count = config.ci.collect.numberOfRuns;
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('Invalid audit run count');
  const dist = resolve(projectRoot, config.ci.collect.staticDistDir);
  await readFile(resolve(dist, 'index.html'));
  const output = resolve(projectRoot, config.ci.upload.outputDir);
  await mkdir(output, { recursive: true });
  // Every invocation has a new output directory; prior reports cannot fill a
  // missing, failed or interrupted current run. Keep evidence on failure too.
  const directory = await mkdtemp(resolve(output, 'audit-'));
  const startedAt = Date.now();
  const manifest = { status: 'incomplete', startedAt: new Date(startedAt).toISOString(), reports: [] };
  const save = () => writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
        '.woff2': 'font/woff2', '.ico': 'image/x-icon' }[extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  try {
    await save();
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    manifest.url = url;
    const reports = [];
    for (let index = 0; index < count; index++) {
      const reportPath = resolve(directory, `run-${index + 1}.json`);
      const runStartedAt = Date.now();
      await invoke({ url, reportPath });
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      // Check each result immediately, including the page, capture freshness
      // and every required category/audit, before another result can mask it.
      const singleConfig = { ...config, ci: { ...config.ci, collect: { ...config.ci.collect, numberOfRuns: 1 } } };
      validateReports([report], singleConfig, { url, startedAt: runStartedAt, finishedAt: Date.now() });
      reports.push(report); manifest.reports.push(reportPath); await save();
    }
    const result = validateReports(reports, config, { url, startedAt, finishedAt: Date.now() });
    manifest.status = 'passed'; manifest.finishedAt = new Date().toISOString(); manifest.warnings = result.warnings;
    await save();
    for (const warning of result.warnings) console.warn(warning);
    console.log(`Lighthouse: ${result.runs} complete fresh audits passed; ${result.warnings.length} score warnings.`);
    return manifest;
  } catch (error) {
    manifest.status = 'failed'; manifest.error = error.message; manifest.finishedAt = new Date().toISOString();
    await save(); throw error;
  } finally { await new Promise(accept => server.close(accept)); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectQuality().catch(error => { console.error(error.message); process.exitCode = 1; });
}
