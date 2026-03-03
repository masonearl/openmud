/**
 * UDOT Market Intelligence Scraper
 *
 * Loads UDOT's public Looker Studio dashboards + Contractor Zone in a hidden
 * Electron BrowserWindow, waits for the JS to render, then extracts structured
 * table data (contractors, project codes, amounts paid, bid tabulations, etc.)
 *
 * Sources:
 *  - Contractor Payments:   https://lookerstudio.google.com/…/65911f69-…
 *  - Advertising/Bids:      https://lookerstudio.google.com/…/2e81147b-…
 *  - Contractor Zone bids:  https://contractorzone.udot.utah.gov/projects
 *  - Bid tab abstracts:     https://contractorzone.udot.utah.gov/bid-tabulation-abstracts
 *  - Unofficial results:    https://contractorzone.udot.utah.gov/unofficial-bid-results
 */

'use strict';

const { BrowserWindow } = require('electron');

// Public UDOT Looker Studio report URLs
const UDOT_SOURCES = {
  payments: {
    url: 'https://lookerstudio.google.com/u/0/reporting/65911f69-a708-4dac-9abb-a90caf87b9e9/page/p_hpbtriuwbd',
    label: 'Contractor Payments',
    waitMs: 14000,
  },
  advertising: {
    url: 'https://lookerstudio.google.com/u/0/reporting/2e81147b-2caf-4105-856d-3bcdcdefab9c/page/p_6a2zjbwync',
    label: 'Advertising / Bid Report',
    waitMs: 14000,
  },
  estimates: {
    url: 'https://lookerstudio.google.com/u/0/reporting/d2c5021a-aec4-409a-923e-8f437a7a53af/page/Mp3RC',
    label: 'Construction Management Estimate',
    waitMs: 14000,
  },
  prequalified: {
    url: 'https://lookerstudio.google.com/u/0/reporting/5b160752-90e5-4eed-a0d9-5bc3b7bb807a/page/cfFkD',
    label: 'Pre-Qualified Contractors',
    waitMs: 12000,
  },
};

/** Parse a dollar string like "$2,063,300.50" → 2063300.50 */
function parseDollar(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[$,\s]/g, ''));
  return isNaN(n) ? null : n;
}

/**
 * Scrape one Looker Studio URL in a hidden BrowserWindow.
 * Returns { headers, rows, source, timestamp } or { error }.
 */
async function scrapeUrl(key) {
  const source = UDOT_SOURCES[key];
  if (!source) return { error: 'Unknown source: ' + key };

  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      width: 1600,
      height: 1000,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,   // needed for executeJavaScript
        webSecurity: true,
      },
    });

    await win.loadURL(source.url, {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // Give Looker Studio time to load data and render tables
    await new Promise((r) => setTimeout(r, source.waitMs));

    const extracted = await win.webContents.executeJavaScript(`
      (function() {
        var results = [];

        // ── Looker Studio tables (rendered as <table> elements) ──────────────
        var tables = document.querySelectorAll('table');
        tables.forEach(function(tbl) {
          var headers = [];
          var rows = [];
          tbl.querySelectorAll('thead tr th, thead tr td').forEach(function(th) {
            headers.push((th.innerText || th.textContent || '').trim());
          });
          // Fallback: first <tr> as header if no <thead>
          if (headers.length === 0) {
            var firstRow = tbl.querySelector('tr');
            if (firstRow) {
              firstRow.querySelectorAll('td, th').forEach(function(cell) {
                headers.push((cell.innerText || cell.textContent || '').trim());
              });
            }
          }
          tbl.querySelectorAll('tbody tr').forEach(function(tr) {
            var cells = [];
            tr.querySelectorAll('td').forEach(function(td) {
              cells.push((td.innerText || td.textContent || '').trim());
            });
            if (cells.length > 0 && cells.some(function(c) { return c.length > 0; })) {
              rows.push(cells);
            }
          });
          if (rows.length > 0) results.push({ headers: headers, rows: rows });
        });

        // ── Looker Studio grid components (if no <table>) ────────────────────
        if (results.length === 0) {
          // Looker Studio sometimes uses divs with role="row" / role="gridcell"
          var gridRows = document.querySelectorAll('[role="row"]');
          var headers = [];
          var rows = [];
          gridRows.forEach(function(row, idx) {
            var cells = [];
            row.querySelectorAll('[role="columnheader"], [role="gridcell"]').forEach(function(cell) {
              cells.push((cell.innerText || cell.textContent || '').trim());
            });
            if (cells.length === 0) {
              row.querySelectorAll('div, span').forEach(function(el) {
                var txt = (el.innerText || el.textContent || '').trim();
                if (txt && el.children.length === 0) cells.push(txt);
              });
            }
            if (idx === 0 && cells.length > 0) headers = cells;
            else if (cells.length > 0) rows.push(cells);
          });
          if (rows.length > 0) results.push({ headers: headers, rows: rows });
        }

        // ── Page title for context ────────────────────────────────────────────
        var title = document.title || '';
        return { title: title, tables: results };
      })();
    `);

    win.destroy();
    win = null;

    return {
      source: source.label,
      url: source.url,
      timestamp: new Date().toISOString(),
      title: extracted.title || source.label,
      tables: extracted.tables || [],
    };
  } catch (err) {
    if (win) { try { win.destroy(); } catch (_) {} }
    return { error: err.message, source: source.label, url: source.url };
  }
}

/**
 * Scrape one or more sources.
 * @param {string|string[]} keys - source key(s): 'payments', 'advertising', 'estimates', 'prequalified', or 'all'
 * @param {function} onProgress - optional callback(message) for status updates
 */
async function scrapeUDOT(keys, onProgress) {
  const emit = onProgress || (() => {});

  if (!Array.isArray(keys)) {
    keys = keys === 'all' ? Object.keys(UDOT_SOURCES) : [keys];
  }

  const results = [];
  for (const key of keys) {
    const label = (UDOT_SOURCES[key] || {}).label || key;
    emit('Loading ' + label + '…');
    const data = await scrapeUrl(key);
    results.push(data);
    if (!data.error) {
      const rowCount = (data.tables || []).reduce((s, t) => s + (t.rows || []).length, 0);
      emit('Got ' + rowCount + ' rows from ' + label + '.');
    } else {
      emit('Could not load ' + label + ': ' + data.error);
    }
  }
  return results;
}

/**
 * Parse contractor payment results into structured contractor objects.
 * Tries to detect the right columns by header name.
 */
function parseContractorPayments(scrapeResults) {
  const contractors = [];
  for (const res of scrapeResults) {
    if (res.error) continue;
    for (const table of (res.tables || [])) {
      const hdrs = (table.headers || []).map((h) => h.toLowerCase());
      const idx = {
        region:      hdrs.findIndex((h) => /region/.test(h)),
        contractor:  hdrs.findIndex((h) => /prime.contractor|contractor|company/.test(h)),
        pin:         hdrs.findIndex((h) => h === 'pin'),
        code:        hdrs.findIndex((h) => /project.code|code/.test(h)),
        description: hdrs.findIndex((h) => /description|desc/.test(h)),
        engineer:    hdrs.findIndex((h) => /engineer/.test(h)),
        estimate:    hdrs.findIndex((h) => /estimate.no/.test(h)),
        amount:      hdrs.findIndex((h) => /amount.paid|amount|paid/.test(h)),
        date:        hdrs.findIndex((h) => /release.date|date/.test(h)),
      };

      for (const row of (table.rows || [])) {
        const get = (key) => (idx[key] >= 0 && idx[key] < row.length) ? row[idx[key]] : '';
        const amount = parseDollar(get('amount'));
        contractors.push({
          source: res.source,
          region: get('region'),
          name: get('contractor'),
          pin: get('pin'),
          projectCode: get('code'),
          description: get('description'),
          residentEngineer: get('engineer'),
          estimateNo: get('estimate'),
          amountPaid: amount,
          amountFormatted: get('amount'),
          date: get('date'),
        });
      }
    }
  }
  // Deduplicate by contractor name + project code; sort by amount desc
  const seen = new Set();
  return contractors
    .filter((c) => {
      if (!c.name) return false;
      const key = c.name + '|' + c.projectCode;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.amountPaid || 0) - (a.amountPaid || 0));
}

/**
 * Aggregate totals by contractor name.
 */
function aggregateByContractor(contractors) {
  const map = {};
  for (const c of contractors) {
    if (!c.name) continue;
    if (!map[c.name]) {
      map[c.name] = { name: c.name, totalPaid: 0, projectCount: 0, projects: [], regions: new Set() };
    }
    map[c.name].totalPaid += c.amountPaid || 0;
    map[c.name].projectCount += 1;
    map[c.name].projects.push({ code: c.projectCode, description: c.description, amount: c.amountPaid, date: c.date });
    if (c.region) map[c.name].regions.add(c.region);
  }
  return Object.values(map)
    .map((c) => ({ ...c, regions: Array.from(c.regions) }))
    .sort((a, b) => b.totalPaid - a.totalPaid);
}

module.exports = { scrapeUDOT, parseContractorPayments, aggregateByContractor, UDOT_SOURCES };
