#!/usr/bin/env node
/**
 * Evaluate mud1 lexical retrieval against a benchmark.
 * Usage:
 *   node mud1/scripts/eval-rag.js
 *   node mud1/scripts/eval-rag.js --strict
 */
const fs = require('fs');
const path = require('path');
const rag = require(path.join(__dirname, '..', 'src', 'rag.js'));

const BENCHMARK_PATH = path.join(__dirname, '..', 'eval', 'retrieval-benchmark.json');
const strictMode = process.argv.includes('--strict');

const CONF_ORDER = { low: 0, medium: 1, high: 2 };

function loadBenchmark() {
  try {
    const raw = fs.readFileSync(BENCHMARK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to load benchmark:', e.message);
    process.exit(1);
  }
}

function confidenceMeets(actual, expected) {
  if (!expected) return true;
  return (CONF_ORDER[actual] || 0) >= (CONF_ORDER[expected] || 0);
}

function matchExpected(entry, expectedAny) {
  if (!entry || !expectedAny || !expectedAny.length) return false;
  const q = String(entry.question || '').toLowerCase();
  return expectedAny.some((ex) => q.includes(String(ex).toLowerCase()));
}

function run() {
  const benchmark = loadBenchmark();
  if (!benchmark.length) {
    console.error('Benchmark is empty.');
    process.exit(1);
  }

  let pass = 0;
  let hitAt1 = 0;
  let hitAt3 = 0;
  const confCounts = { low: 0, medium: 0, high: 0 };

  for (const [idx, row] of benchmark.entries()) {
    const query = String(row.query || '');
    const pkg = rag.getRAGPackage(query, 3);
    const entries = Array.isArray(pkg.entries) ? pkg.entries : [];
    const top = entries[0] || null;
    const c = pkg.confidence || 'low';
    if (confCounts[c] != null) confCounts[c] += 1;

    let rowPass = false;
    if (row.must_be_empty) {
      rowPass = entries.length === 0;
    } else {
      const expectedAny = Array.isArray(row.expected_any) ? row.expected_any : [];
      const topMatch = matchExpected(top, expectedAny);
      const top3Match = entries.some((e) => matchExpected(e, expectedAny));
      if (topMatch) hitAt1 += 1;
      if (top3Match) hitAt3 += 1;
      rowPass = top3Match && confidenceMeets(c, row.min_confidence);
    }

    if (rowPass) pass += 1;
    const icon = rowPass ? 'PASS' : 'FAIL';
    const topQ = top ? top.question : '(none)';
    console.log(`${icon} [${idx + 1}] ${query}`);
    console.log(`  confidence=${c} top="${topQ}"`);
  }

  const total = benchmark.length;
  const passRate = ((pass / total) * 100).toFixed(1);
  const hit1Rate = ((hitAt1 / total) * 100).toFixed(1);
  const hit3Rate = ((hitAt3 / total) * 100).toFixed(1);

  console.log('\n=== RAG Eval Summary ===');
  console.log(`benchmark_size: ${total}`);
  console.log(`pass_count: ${pass}`);
  console.log(`pass_rate: ${passRate}%`);
  console.log(`hit@1: ${hit1Rate}%`);
  console.log(`hit@3: ${hit3Rate}%`);
  console.log(`confidence_distribution: high=${confCounts.high}, medium=${confCounts.medium}, low=${confCounts.low}`);

  if (strictMode && pass / total < 0.75) {
    console.error('\nStrict mode failed: pass_rate below 75%.');
    process.exit(2);
  }
}

run();
