/**
 * Bid Watcher — background agent that monitors bid portals on a schedule.
 * Persists watch criteria and seen-bid hashes in userData/storage/bid-watches.json.
 * Triggers desktop notifications when new matching bids appear.
 */
const path = require('path');
const crypto = require('crypto');

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

let _storage = null;
let _bidFinder = null;
let _notifyFn = null;
let _intervalId = null;

function init(storage, bidFinder, notifyFn) {
  _storage = storage;
  _bidFinder = bidFinder;
  _notifyFn = notifyFn;
}

function getWatches() {
  if (!_storage) return [];
  try {
    const data = _storage.getUserData();
    return data.bidWatches || [];
  } catch (_) { return []; }
}

function setWatches(watches) {
  if (!_storage) return;
  try {
    const data = _storage.getUserData();
    data.bidWatches = watches;
    _storage.setUserData(data);
  } catch (_) {}
}

function getSeenHashes() {
  if (!_storage) return {};
  try {
    const data = _storage.getUserData();
    return data.bidWatchSeen || {};
  } catch (_) { return {}; }
}

function setSeenHashes(seen) {
  if (!_storage) return;
  try {
    const data = _storage.getUserData();
    data.bidWatchSeen = seen;
    _storage.setUserData(data);
  } catch (_) {}
}

function hashBid(bid) {
  const key = `${bid.title || ''}|${bid.agency || bid.source || ''}|${bid.due || bid.responseDeadLine || ''}`;
  return crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
}

function addWatch(criteria) {
  const watches = getWatches();
  const id = crypto.randomBytes(6).toString('hex');
  const watch = {
    id,
    trade: criteria.trade || null,
    location: criteria.location || null,
    keywords: criteria.keywords || null,
    min_value: criteria.min_value || null,
    created_at: new Date().toISOString(),
    enabled: true,
  };
  watches.push(watch);
  setWatches(watches);
  return watch;
}

function removeWatch(watchId) {
  let watches = getWatches();
  watches = watches.filter(w => w.id !== watchId);
  setWatches(watches);
  return watches;
}

function listWatches() {
  return getWatches().filter(w => w.enabled);
}

async function checkWatch(watch) {
  if (!_bidFinder) return [];
  const samKey = process.env.SAM_GOV_API_KEY || null;
  const results = await _bidFinder.findBids(watch.trade, watch.location, samKey).catch(() => ({ bids: [] }));
  let bids = results.bids || [];

  if (watch.keywords) {
    const kw = watch.keywords.toLowerCase();
    bids = bids.filter(b => {
      const text = `${b.title || ''} ${b.description || ''} ${b.agency || ''}`.toLowerCase();
      return kw.split(/\s+/).some(k => text.includes(k));
    });
  }

  if (watch.min_value) {
    bids = bids.filter(b => {
      const val = parseFloat(String(b.estimatedValue || b.value || 0).replace(/[^0-9.]/g, ''));
      return val >= watch.min_value;
    });
  }

  return bids;
}

async function runAllWatches() {
  const watches = listWatches();
  if (watches.length === 0) return;

  const seen = getSeenHashes();
  let totalNew = 0;
  const newBidsAll = [];

  for (const watch of watches) {
    try {
      const bids = await checkWatch(watch);
      const watchKey = watch.id;
      if (!seen[watchKey]) seen[watchKey] = [];

      const newBids = bids.filter(b => {
        const h = hashBid(b);
        return !seen[watchKey].includes(h);
      });

      if (newBids.length > 0) {
        const newHashes = newBids.map(hashBid);
        seen[watchKey] = [...seen[watchKey], ...newHashes].slice(-200);
        totalNew += newBids.length;
        newBidsAll.push({ watch, bids: newBids });
      }
    } catch (e) {
      console.warn(`[bid-watcher] watch ${watch.id} failed:`, e.message);
    }
  }

  setSeenHashes(seen);

  if (totalNew > 0 && _notifyFn) {
    const tradeLabels = newBidsAll.map(r => r.watch.trade || 'construction').join(', ');
    _notifyFn({
      title: `${totalNew} new bid${totalNew !== 1 ? 's' : ''} found`,
      body: `New ${tradeLabels} bids matching your criteria`,
      bids: newBidsAll,
    });
  }

  return { checked: watches.length, newBids: totalNew };
}

function start() {
  if (_intervalId) return;
  // Run first check after 30 seconds (let the app finish loading)
  setTimeout(() => {
    runAllWatches().catch(e => console.warn('[bid-watcher] check failed:', e.message));
  }, 30000);
  _intervalId = setInterval(() => {
    runAllWatches().catch(e => console.warn('[bid-watcher] check failed:', e.message));
  }, CHECK_INTERVAL_MS);
}

function stop() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

module.exports = { init, start, stop, addWatch, removeWatch, listWatches, runAllWatches, checkWatch };
