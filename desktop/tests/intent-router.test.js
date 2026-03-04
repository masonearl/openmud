const assert = require('assert');
const {
  FILE_MANAGEMENT_INTENT,
  normalizeUserIntentText,
  arbitrateCoreIntent,
} = require('../intent-router');

function run() {
  const cleaned = normalizeUserIntentText(
    'take out duplicates [ATTACHED DOCUMENTS]foo[/ATTACHED DOCUMENTS] [Project has 4 uploaded document(s): A.csv, B.csv.]'
  );
  assert.strictEqual(cleaned, 'take out duplicates');

  assert.ok(FILE_MANAGEMENT_INTENT.test('take out duplicates'));
  assert.ok(FILE_MANAGEMENT_INTENT.test('remove dupes from project'));

  const duplicateIntent = arbitrateCoreIntent('take out duplicates');
  assert.strictEqual(duplicateIntent.primary, 'file_management');
  assert.strictEqual(duplicateIntent.needsDisambiguation, false);

  const hcssIntent = arbitrateCoreIntent('export to HCSS HeavyBid');
  assert.strictEqual(hcssIntent.primary, 'hcss_export');
  assert.strictEqual(hcssIntent.needsDisambiguation, false);

  const ambiguous = arbitrateCoreIntent('remove duplicates and export to HCSS');
  assert.strictEqual(ambiguous.needsDisambiguation, true);

  console.log('intent-router tests passed');
}

run();
