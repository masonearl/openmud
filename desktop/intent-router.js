const FILE_MANAGEMENT_INTENT = /\b(duplicate|dupes?)\b(?:.{0,40}\b(file|doc|document)s?\b)?|\b(take\s+out|remove|delete|clean\s+up|organize|sort|manage)\b.{0,40}\b(file|doc|document|duplicates?|dupes?|project)\b|\b(file|doc|document)s?\b.{0,40}\b(take\s+out|remove|delete|duplicate|dupes?|organize|sort|manage)\b|\bfind\s+(duplicate|dupes?)\b|\bclean\s+up\s+(the\s+)?(project|file|doc|duplicates?|dupes?)\b|\b(take\s+out|remove|delete)\s+(the\s+)?(duplicates?|dupes?)\b/i;
const CREATE_CSV_INTENT = /\b(create|make|build|generate|export|give\s+me)\b.{0,50}\b(csv|spreadsheet|sheet)\b.{0,60}\b(bid|scope|items?|quantities|takeoff|line\s+items?|estimate)\b|\b(csv|spreadsheet)\b.{0,40}\b(bid|scope|items?|quantities)\b|\b(export|pull\s+out|extract|put)\b.{0,50}\b(bid\s+items?|line\s+items?|quantities|scope|takeoff)\b.{0,30}\b(csv|spreadsheet|excel|sheet)\b|\b(scan|go\s+through|search\s+through|look\s+(through|at))\b.{0,60}\b(files?|docs?|documents?)\b.{0,60}\b(csv|scope|bid\s+items?|quantities)\b/i;
const HCSS_EXPORT_INTENT = /\b(hcss|heavybid|heavy\s*bid)\b|\bexport\b.{0,40}\b(hcss|heavybid)\b|\b(hcss|heavybid)\b.{0,40}\b(import|csv|export|format)\b|\bcreate\b.{0,40}\bhcss\b/i;
const BID2WIN_EXPORT_INTENT = /\b(bid2win|bid\s*to\s*win|b2w)\b|\bexport\b.{0,40}\b(bid2win|bid\s*to\s*win)\b|\b(bid2win|bid\s*to\s*win)\b.{0,40}\b(import|csv|export|format)\b/i;

function normalizeUserIntentText(userText) {
  let t = String(userText || '');
  t = t.replace(/\[ATTACHED DOCUMENTS\][\s\S]*?\[\/ATTACHED DOCUMENTS\]/gi, ' ');
  t = t.replace(/\[(?:Project has|Canvas mode\.|User is viewing:)[\s\S]*?\]/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function arbitrateCoreIntent(userText) {
  const t = String(userText || '').toLowerCase().trim();
  if (!t) return { primary: null, needsDisambiguation: false };

  const hasFileSignals = /\b(duplicates?|dupes?|remove|delete|clean\s+up|organize|sort|manage|file|doc|document|project)\b/i.test(t);
  const hasExportSignals = /\b(hcss|heavybid|bid2win|b2w|csv|export|import|format)\b/i.test(t);
  if (!hasFileSignals && !hasExportSignals) return { primary: null, needsDisambiguation: false };

  const score = { file_management: 0, hcss_export: 0, bid2win_export: 0, csv_scan: 0 };

  if (FILE_MANAGEMENT_INTENT.test(t)) score.file_management += 45;
  if (/\b(duplicate|dupe)s?\b/i.test(t)) score.file_management += 35;
  if (/\b(take\s+out|remove|delete|clean\s+up)\s+(the\s+)?(duplicates?|dupes?)\b/i.test(t)) score.file_management += 40;
  if (/\b(file|doc|document|project)\b/i.test(t)) score.file_management += 8;

  if (HCSS_EXPORT_INTENT.test(t)) score.hcss_export += 30;
  if (/\b(hcss|heavybid|heavy\s*bid)\b/i.test(t)) score.hcss_export += 18;
  if (/\b(export|import|format|create|generate)\b/i.test(t)) score.hcss_export += 18;

  if (BID2WIN_EXPORT_INTENT.test(t)) score.bid2win_export += 30;
  if (/\b(bid2win|bid\s*to\s*win|b2w)\b/i.test(t)) score.bid2win_export += 18;
  if (/\b(export|import|format|create|generate)\b/i.test(t)) score.bid2win_export += 18;

  if (CREATE_CSV_INTENT.test(t)) score.csv_scan += 25;
  if (/\b(csv|spreadsheet|sheet)\b/i.test(t)) score.csv_scan += 12;

  // Duplicate cleanup should dominate unless user clearly asked to export.
  if (/\b(duplicate|dupe)s?\b/i.test(t) && !/\b(export|import|format)\b/i.test(t)) {
    score.file_management += 50;
  }

  const hasDuplicate = /\b(duplicate|dupe)s?\b/i.test(t);
  const hasExportVerb = /\b(export|import|format)\b/i.test(t);
  const hasHCSSOrB2W = /\b(hcss|heavybid|bid2win|b2w|bid\s*to\s*win)\b/i.test(t);
  if (hasDuplicate && hasExportVerb && hasHCSSOrB2W) {
    return { primary: 'file_management', needsDisambiguation: true, topScore: score.file_management, second: 'hcss_export', secondScore: score.hcss_export };
  }

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top[1] < 30) return { primary: null, needsDisambiguation: false };
  if (second && second[1] > 0 && top[1] - second[1] < 8) {
    return { primary: top[0], needsDisambiguation: true, topScore: top[1], second: second[0], secondScore: second[1] };
  }
  return { primary: top[0], needsDisambiguation: false, topScore: top[1], second: second ? second[0] : null, secondScore: second ? second[1] : 0 };
}

module.exports = {
  FILE_MANAGEMENT_INTENT,
  CREATE_CSV_INTENT,
  HCSS_EXPORT_INTENT,
  BID2WIN_EXPORT_INTENT,
  normalizeUserIntentText,
  arbitrateCoreIntent,
};
