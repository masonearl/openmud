#!/usr/bin/env node
/**
 * Test mud1 RAG retrieval.
 * Usage: node mud1/scripts/test-rag.js [query]
 * Or run without args to test a batch.
 */
const path = require('path');
const rag = require(path.join(__dirname, '..', 'src', 'rag.js'));

const TEST_QUERIES = [
  'how much does 8 inch sewer pipe cost per foot?',
  'what are labor rates for operator?',
  'what is pipe bedding?',
  'clay soil cost',
  'difference between sewer and waterline',
  'how do I size pipe?',
  'what is mud1?',
  'how do I write a payment application?',
  'draft an rfi for conflicting plan sheets',
  'how do i manage submittals?',
  'what is a change order process?',
  'how do I create a proposal?',
  'organize my desktop', // Should NOT match RAG - reserved for tools
];

function run(query) {
  const pkg = rag.getRAGPackage(query, 3);
  const result = pkg.entries && pkg.entries[0] ? pkg.entries[0] : null;
  if (result && result.score > 0) {
    console.log('✓', query);
    console.log('  →', result.answer.slice(0, 80) + (result.answer.length > 80 ? '…' : ''));
    console.log('  ↳', `score=${result.score} confidence=${pkg.confidence} source=${result.source || 'construction-qa'}`);
  } else {
    const reason = pkg.fallback_used ? 'no grounded match' : 'low confidence match';
    console.log('✗', query, `(${reason})`);
  }
}

const query = process.argv[2];
if (query) {
  run(query);
} else {
  console.log('mud1 RAG test\n');
  for (const q of TEST_QUERIES) {
    run(q);
    console.log('');
  }
}
