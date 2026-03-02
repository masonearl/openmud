#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const BASE_URL = (process.env.BASE_URL || 'https://openmud.ai').replace(/\/$/, '');
const HEADLESS = process.env.HEADLESS !== 'false';
const BROWSER_CHANNEL = process.env.BOT_BROWSER_CHANNEL || '';
const SLOW_MO_MS = Number(process.env.BOT_SLOW_MO_MS || 0);
const PAGE_TIMEOUT_MS = Number(process.env.BOT_PAGE_TIMEOUT_MS || 30000);
const CHAT_TIMEOUT_MS = Number(process.env.BOT_CHAT_TIMEOUT_MS || 90000);
const TAKE_SCREENSHOTS = process.env.BOT_SCREENSHOTS === '1';
const BOT_FAIL_ON = (process.env.BOT_FAIL_ON || 'high').toLowerCase();
const PAGE_WARN_MS = Number(process.env.BOT_PAGE_WARN_MS || 8000);
const CHAT_PAGE_WARN_MS = Number(process.env.BOT_CHAT_PAGE_WARN_MS || 15000);
const OUTPUT_DIR = path.join(process.cwd(), 'reports', 'site-bot');
const LATEST_JSON = path.join(OUTPUT_DIR, 'latest.json');
const LATEST_MD = path.join(OUTPUT_DIR, 'latest.md');
const EXTERNAL_ASSET_NOISE = /(youtube\.com|ytimg\.com|fonts\.gstatic\.com|videos\.pexels\.com)/i;

const STATIC_PATHS = [
  '/',
  '/about.html',
  '/tools.html',
  '/chat.html',
  '/calculators.html',
  '/resources.html',
  '/innovators.html',
  '/companies.html',
  '/documentation.html',
];

const CHAT_PROBES = [
  {
    id: 'estimate_outline',
    prompt: 'Give me a quick estimate outline for 1500 LF of 8 inch sewer in clay.',
    checks: [
      {
        id: 'mentions_estimate_or_cost',
        severity: 'high',
        description: 'Estimate prompts should mention cost/estimate language.',
        requiredAny: [/\bcost\b/i, /\bestimate\b/i, /\b\d[\d,]*\b/],
      },
    ],
  },
  {
    id: 'osha_type_c_slope',
    prompt: 'What is OSHA Type C trench slope requirement in plain language?',
    checks: [
      {
        id: 'type_c_expected_ratio',
        severity: 'critical',
        description: 'Type C slope should indicate ~1.5H:1V (34 degrees).',
        requiredAny: [/1\.5\s*[:\-]\s*1/i, /1\.5h\s*[:\-]\s*1v/i, /34\s*°/i, /34\s*degrees/i],
      },
      {
        id: 'reject_type_c_one_to_one',
        severity: 'critical',
        description: 'Type C slope must not be reported as 1:1.',
        forbiddenAny: [/\b1\s*[:\-]\s*1\b/i],
      },
    ],
  },
];

const SEVERITY_RANK = { info: 0, warn: 1, high: 2, critical: 3 };
const SHOULD_ENFORCE_FAIL = BOT_FAIL_ON !== 'none';
const FAIL_THRESHOLD_RANK = BOT_FAIL_ON in SEVERITY_RANK ? SEVERITY_RANK[BOT_FAIL_ON] : SEVERITY_RANK.high;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function clip(text, max = 500) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function auditPage(page, pagePath, index, errors) {
  const targetUrl = `${BASE_URL}${pagePath}`;
  const startedAt = Date.now();
  let status = null;
  let ok = false;
  let title = '';
  let h1 = '';
  let linkCount = 0;
  let visibleTextSample = '';

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS,
    });
    status = response ? response.status() : null;
    ok = !!(response && response.ok());

    await page.waitForTimeout(250);
    title = await page.title();
    const h1Locator = page.locator('h1');
    if (await h1Locator.count()) {
      h1 = await h1Locator.first().textContent({ timeout: 2000 }).catch(() => '');
    }
    linkCount = await page.locator('a[href]').count();
    visibleTextSample = await page
      .locator('body')
      .innerText()
      .then((t) => clip(t, 260))
      .catch(() => '');

    if (TAKE_SCREENSHOTS) {
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `page-${String(index).padStart(2, '0')}.png`),
        fullPage: true,
      });
    }
  } catch (err) {
    errors.push(`Page audit failed for ${targetUrl}: ${err.message}`);
  }

  return {
    path: pagePath,
    url: targetUrl,
    ok,
    status,
    title: clip(title, 120),
    h1: clip(h1, 140),
    linkCount,
    elapsedMs: Date.now() - startedAt,
    sample: visibleTextSample,
  };
}

function checkProbeText(responseText, probe) {
  const findings = [];
  const text = String(responseText || '');
  const textLower = text.toLowerCase();
  (probe.checks || []).forEach((check) => {
    if (Array.isArray(check.requiredAny) && check.requiredAny.length > 0) {
      const matched = check.requiredAny.some((rx) => rx.test(text));
      if (!matched) {
        findings.push({
          severity: check.severity || 'high',
          kind: 'chat_validation',
          probeId: probe.id,
          checkId: check.id,
          message: check.description,
        });
      }
    }
    if (Array.isArray(check.forbiddenAny) && check.forbiddenAny.length > 0) {
      let forbiddenHit = check.forbiddenAny.some((rx) => rx.test(text));
      if (forbiddenHit && check.id === 'reject_type_c_one_to_one') {
        // Allow explicit negative guidance like "do not use 1:1".
        const oneToOneMentions = [...textLower.matchAll(/1\s*[:\-]\s*1/g)];
        forbiddenHit = oneToOneMentions.some((m) => {
          const idx = m.index || 0;
          const left = textLower.slice(Math.max(0, idx - 24), idx);
          return !/(do not|don't|never|not)/.test(left);
        });
      }
      if (forbiddenHit) {
        findings.push({
          severity: check.severity || 'high',
          kind: 'chat_validation',
          probeId: probe.id,
          checkId: check.id,
          message: check.description,
        });
      }
    }
  });
  return findings;
}

async function runChatProbe(page, probe, idx, errors) {
  const targetUrl = `${BASE_URL}/chat.html`;
  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      await page.locator('#chat-input').waitFor({ state: 'visible', timeout: PAGE_TIMEOUT_MS });
      await page.locator('#projects-list .project-item').first().waitFor({ state: 'visible', timeout: 15000 });

      const assistantMessages = page.locator('.msg-assistant p');
      const beforeCount = await assistantMessages.count();

      await page.fill('#chat-input', probe.prompt);
      await page.click('#chat-send');

      await page.waitForFunction(
        ({ selector, before }) => document.querySelectorAll(selector).length > before,
        { selector: '.msg-assistant p', before: beforeCount },
        { timeout: CHAT_TIMEOUT_MS }
      );

      const afterCount = await assistantMessages.count();
      const responseText = afterCount > 0 ? await assistantMessages.nth(afterCount - 1).innerText() : '';

      if (TAKE_SCREENSHOTS) {
        await page.screenshot({
          path: path.join(OUTPUT_DIR, `chat-${String(idx).padStart(2, '0')}.png`),
          fullPage: true,
        });
      }

      const validationFindings = checkProbeText(responseText, probe);

      return {
        id: probe.id,
        prompt: probe.prompt,
        ok: true,
        elapsedMs: Date.now() - startedAt,
        responseSample: clip(responseText, 320),
        responseLength: responseText.length,
        validationFindings,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await page.waitForTimeout(1000);
      }
    }
  }

  const message = `Chat probe failed for prompt "${probe.prompt}": ${lastError.message}`;
  errors.push(message);
  return {
    id: probe.id,
    prompt: probe.prompt,
    ok: false,
    elapsedMs: Date.now() - startedAt,
    error: lastError.message,
    validationFindings: [],
    attempts: 2,
  };
}

function summarizeHealth(findings) {
  const counts = { critical: 0, high: 0, warn: 0, info: 0 };
  findings.forEach((f) => {
    if (f.severity in counts) counts[f.severity] += 1;
  });
  const maxSeverity = findings.reduce((acc, f) => (
    SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc
  ), 'info');
  const status = SEVERITY_RANK[maxSeverity] >= SEVERITY_RANK.high
    ? 'fail'
    : SEVERITY_RANK[maxSeverity] >= SEVERITY_RANK.warn
      ? 'warn'
      : 'pass';
  return { status, maxSeverity, counts };
}

function analyzeFindings(summary) {
  const findings = [];
  const seen = new Set();
  const pushFinding = (finding) => {
    const key = `${finding.severity}|${finding.kind}|${finding.path || ''}|${finding.probeId || ''}|${finding.checkId || ''}|${finding.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };

  summary.pages.forEach((p) => {
    if (!p.ok || p.status !== 200) {
      pushFinding({
        severity: 'critical',
        kind: 'page_status',
        path: p.path,
        message: `Page returned bad status: ${p.status ?? 'unknown'}`,
      });
    }
    const threshold = p.path === '/chat.html' ? CHAT_PAGE_WARN_MS : PAGE_WARN_MS;
    if (p.elapsedMs > threshold) {
      pushFinding({
        severity: p.path === '/chat.html' ? 'high' : 'warn',
        kind: 'page_latency',
        path: p.path,
        message: `Page load slow: ${p.elapsedMs}ms (threshold ${threshold}ms)`,
      });
    }
  });

  summary.chat.forEach((c) => {
    if (!c.ok) {
      pushFinding({
        severity: 'high',
        kind: 'chat_timeout_or_error',
        probeId: c.id,
        message: `Chat probe failed: ${c.error || 'unknown error'}`,
      });
    }
    (c.validationFindings || []).forEach((vf) => pushFinding(vf));
  });

  summary.errors.forEach((errText) => {
    if (EXTERNAL_ASSET_NOISE.test(errText)) {
      pushFinding({
        severity: 'info',
        kind: 'external_asset_noise',
        message: `External asset request aborted: ${clip(errText, 180)}`,
      });
      return;
    }
    if (errText.includes('videos.pexels.com') && errText.includes('ERR_ABORTED')) {
      pushFinding({
        severity: 'warn',
        kind: 'asset_request',
        message: `Non-blocking media fetch aborted: ${clip(errText, 180)}`,
      });
      return;
    }
    pushFinding({
      severity: 'warn',
      kind: 'request_failed',
      message: errText,
    });
  });

  return findings;
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push(`# Site Bot Report`);
  lines.push('');
  lines.push(`- Timestamp: ${summary.timestamp}`);
  lines.push(`- Base URL: ${summary.baseUrl}`);
  lines.push(`- Browser: ${summary.browser}`);
  lines.push(`- Headless: ${summary.headless}`);
  lines.push(`- Health: ${summary.health.status.toUpperCase()} (max severity: ${summary.health.maxSeverity})`);
  lines.push('');

  lines.push('## Page Audit');
  lines.push('');
  lines.push('| Path | Status | OK | Time (ms) | Title |');
  lines.push('|---|---:|:---:|---:|---|');
  summary.pages.forEach((p) => {
    lines.push(`| \`${p.path}\` | ${p.status ?? '-'} | ${p.ok ? 'yes' : 'no'} | ${p.elapsedMs} | ${p.title || '-'} |`);
  });
  lines.push('');

  lines.push('## Chat Probes');
  lines.push('');
  summary.chat.forEach((c, i) => {
    lines.push(`### Prompt ${i + 1}`);
    lines.push(`- Prompt: ${c.prompt}`);
    lines.push(`- OK: ${c.ok ? 'yes' : 'no'}`);
    lines.push(`- Time: ${c.elapsedMs} ms`);
    if (c.ok) {
      lines.push(`- Response sample: ${c.responseSample || '-'}`);
      if (Array.isArray(c.validationFindings) && c.validationFindings.length > 0) {
        lines.push(`- Validation issues: ${c.validationFindings.length}`);
      }
    } else {
      lines.push(`- Error: ${c.error || 'Unknown error'}`);
    }
    lines.push('');
  });

  if (summary.findings.length > 0) {
    lines.push('## Findings');
    lines.push('');
    lines.push('| Severity | Kind | Details |');
    lines.push('|---|---|---|');
    summary.findings.forEach((f) => {
      const extra = [f.path ? `path=${f.path}` : '', f.probeId ? `probe=${f.probeId}` : '']
        .filter(Boolean)
        .join(' ');
      lines.push(`| ${f.severity.toUpperCase()} | ${f.kind} | ${f.message}${extra ? ` (${extra})` : ''} |`);
    });
    lines.push('');
  }

  if (summary.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    summary.errors.forEach((e) => lines.push(`- ${e}`));
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const timestamp = new Date().toISOString();
  const runId = stamp();

  const browserLaunchOptions = {
    headless: HEADLESS,
    slowMo: SLOW_MO_MS > 0 ? SLOW_MO_MS : undefined,
    channel: BROWSER_CHANNEL || undefined,
  };
  const browser = await chromium.launch(browserLaunchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const seenRequestErrors = new Set();

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    if (!failure) return;
    const url = request.url();
    if (url.includes('_vercel/insights') || url.includes('_vercel/speed-insights')) return;
    const key = `${url} (${failure.errorText})`;
    if (seenRequestErrors.has(key)) return;
    seenRequestErrors.add(key);
    errors.push(`Request failed: ${key}`);
  });

  const pages = [];
  for (let i = 0; i < STATIC_PATHS.length; i += 1) {
    // Sequential page navigation keeps output deterministic.
    pages.push(await auditPage(page, STATIC_PATHS[i], i + 1, errors));
  }

  const chat = [];
  for (let i = 0; i < CHAT_PROBES.length; i += 1) {
    chat.push(await runChatProbe(page, CHAT_PROBES[i], i + 1, errors));
  }

  await context.close();
  await browser.close();

  const summary = {
    runId,
    timestamp,
    baseUrl: BASE_URL,
    browser: BROWSER_CHANNEL ? `chromium (${BROWSER_CHANNEL})` : 'chromium',
    headless: HEADLESS,
    pages,
    chat,
    errors,
  };
  summary.findings = analyzeFindings(summary);
  summary.health = summarizeHealth(summary.findings);

  const jsonPath = path.join(OUTPUT_DIR, `report-${runId}.json`);
  const mdPath = path.join(OUTPUT_DIR, `report-${runId}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, buildMarkdown(summary), 'utf8');
  fs.copyFileSync(jsonPath, LATEST_JSON);
  fs.copyFileSync(mdPath, LATEST_MD);

  console.log(`Site bot completed.`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
  console.log(`Page checks: ${pages.length}, chat probes: ${chat.length}, errors: ${errors.length}`);
  console.log(`Health: ${summary.health.status.toUpperCase()} (${summary.health.maxSeverity})`);

  if (SHOULD_ENFORCE_FAIL) {
    const hasFailingSeverity = summary.findings.some((f) => (
      SEVERITY_RANK[f.severity] >= FAIL_THRESHOLD_RANK
    ));
    if (hasFailingSeverity) {
      process.exitCode = 1;
      console.error(`Fail threshold triggered (BOT_FAIL_ON=${BOT_FAIL_ON}).`);
    }
  }
}

main().catch((err) => {
  console.error('Site bot failed:', err);
  process.exit(1);
});
