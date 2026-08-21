import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const cli = process.argv.slice(2);
function option(name, fallback) {
  const index = cli.indexOf(name);
  return index >= 0 && cli[index + 1] ? cli[index + 1] : fallback;
}

function describeError(error) {
  const name = error?.name || 'Error';
  const message = String(error?.message || error);
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  return stack.includes(message) ? stack : `${name}: ${message}${stack ? `\n${stack}` : ''}`;
}

const browserName = option('--browser', 'chromium');
const browserType = { chromium, firefox, webkit }[browserName];
if (!browserType) throw new Error(`Unknown browser: ${browserName}`);
const baseUrl = new URL(option('--base-url', 'http://127.0.0.1:8000/'));
const outputDirectory = resolve(option('--output-dir', '.w6-ci'));
const timeoutMs = Number.parseInt(option('--timeout-seconds', '300'), 10) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error('Invalid timeout.');

const gates = [
  {
    id: 'kallisto-regression',
    path: 'build/browser-regression.html',
    ready: "window.__regressionResult && typeof window.__regressionResult.ok === 'boolean'",
    result: 'window.__regressionResult',
    passed: (result) => result?.ok === true,
  },
  {
    id: 'w5-hisat2-pipeline',
    path: 'tools/w5-pipeline/tests/browser-gate.html',
    ready: "window.__w5GateResult && ['passed', 'failed'].includes(window.__w5GateResult.state)",
    result: 'window.__w5GateResult',
    passed: (result) => result?.state === 'passed',
  },
  {
    id: 'w6-release-gate',
    path: 'tools/w6-validation/tests/browser-gate.html',
    ready: "window.__w6GateResult && ['passed', 'failed'].includes(window.__w6GateResult.state)",
    result: 'window.__w6GateResult',
    passed: (result) => result?.state === 'passed',
  },
];

await mkdir(outputDirectory, { recursive: true });
const browser = await browserType.launch({ headless: true });
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  requested_browser: browserName,
  browser_version: browser.version(),
  base_url: baseUrl.href,
  gates: [],
};

try {
  for (const gate of gates) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const logs = [];
    page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => logs.push({ type: 'pageerror', text: String(error?.stack || error) }));
    const started = Date.now();
    const gateReport = { id: gate.id, url: new URL(gate.path, baseUrl).href, state: 'running', logs };
    report.gates.push(gateReport);
    try {
      await page.goto(gateReport.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForFunction(gate.ready, undefined, { timeout: timeoutMs });
      gateReport.result = await page.evaluate(gate.result);
      gateReport.environment = await page.evaluate(() => ({
        user_agent: navigator.userAgent,
        cross_origin_isolated: crossOriginIsolated,
        opfs: typeof navigator.storage?.getDirectory === 'function',
        shared_array_buffer: typeof SharedArrayBuffer === 'function',
      }));
      gateReport.state = gate.passed(gateReport.result) ? 'passed' : 'failed';
      if (gateReport.state !== 'passed') throw new Error(`${gate.id} reported failure.`);
    } catch (error) {
      gateReport.state = 'failed';
      gateReport.error = describeError(error);
      await page.screenshot({ path: resolve(outputDirectory, `${browserName}-${gate.id}.png`), fullPage: true }).catch(() => {});
    } finally {
      gateReport.elapsed_ms = Date.now() - started;
      await context.close();
      await writeFile(resolve(outputDirectory, `${browserName}.json`), `${JSON.stringify(report, null, 2)}\n`);
    }
  }
} finally {
  await browser.close();
}

const failures = report.gates.filter((gate) => gate.state !== 'passed');
if (failures.length) {
  console.error(`${browserName}: ${failures.map((gate) => gate.id).join(', ')} failed.`);
  process.exitCode = 1;
} else {
  console.log(`${browserName}: all ${report.gates.length} W6 browser gates passed.`);
}
