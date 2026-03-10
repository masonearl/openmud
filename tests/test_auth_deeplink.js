#!/usr/bin/env node
/**
 * Unit tests for the auth deep link handling in desktop/main.js.
 * Tests the cold-start fix: deep links received before the window is ready
 * are stored and replayed once the window loads.
 */
const assert = require('assert');

// Simulate the deep link handling logic (extracted from desktop/main.js)
let pendingDeepLinkUrl = null;
let mainWindowRef = null;
const sentMessages = [];

function createMockWindow() {
  return {
    isDestroyed: () => false,
    focus: () => {},
    webContents: {
      send: (channel, data) => { sentMessages.push({ channel, data }); },
    },
  };
}

function handleDeepLink(url) {
  if (!url) return;
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    pendingDeepLinkUrl = url;
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth') {
      const accessToken = parsed.searchParams.get('access_token');
      const refreshToken = parsed.searchParams.get('refresh_token');
      if (accessToken && refreshToken) {
        mainWindowRef.webContents.send('mudrag:auth-callback', {
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      }
    }
  } catch (e) {
    // ignore
  }
  mainWindowRef.focus();
}

function processPendingDeepLink() {
  if (pendingDeepLinkUrl) {
    const url = pendingDeepLinkUrl;
    pendingDeepLinkUrl = null;
    handleDeepLink(url);
  }
}

// Test 1: Deep link before window exists queues the URL
console.log('Test 1: Deep link queued when window not ready');
pendingDeepLinkUrl = null;
mainWindowRef = null;
sentMessages.length = 0;
handleDeepLink('openmud://auth?access_token=tok123&refresh_token=ref456');
assert.strictEqual(pendingDeepLinkUrl, 'openmud://auth?access_token=tok123&refresh_token=ref456');
assert.strictEqual(sentMessages.length, 0);
console.log('  PASS');

// Test 2: processPendingDeepLink replays when window is ready
console.log('Test 2: Pending URL processed after window ready');
mainWindowRef = createMockWindow();
processPendingDeepLink();
assert.strictEqual(pendingDeepLinkUrl, null);
assert.strictEqual(sentMessages.length, 1);
assert.strictEqual(sentMessages[0].channel, 'mudrag:auth-callback');
assert.strictEqual(sentMessages[0].data.access_token, 'tok123');
assert.strictEqual(sentMessages[0].data.refresh_token, 'ref456');
console.log('  PASS');

// Test 3: Direct deep link when window exists sends immediately
console.log('Test 3: Direct deep link sends immediately');
sentMessages.length = 0;
handleDeepLink('openmud://auth?access_token=abc&refresh_token=def');
assert.strictEqual(sentMessages.length, 1);
assert.strictEqual(sentMessages[0].data.access_token, 'abc');
assert.strictEqual(sentMessages[0].data.refresh_token, 'def');
console.log('  PASS');

// Test 4: openmud://try does not send auth callback
console.log('Test 4: try deep link does not send auth callback');
sentMessages.length = 0;
handleDeepLink('openmud://try');
assert.strictEqual(sentMessages.length, 0);
console.log('  PASS');

// Test 5: Missing tokens does not send auth callback
console.log('Test 5: Missing tokens does not send callback');
sentMessages.length = 0;
handleDeepLink('openmud://auth?access_token=tok_only');
assert.strictEqual(sentMessages.length, 0);
console.log('  PASS');

// Test 6: Invalid URL does not throw
console.log('Test 6: Invalid URL handled gracefully');
sentMessages.length = 0;
handleDeepLink('not-a-valid-url');
assert.strictEqual(sentMessages.length, 0);
console.log('  PASS');

// Test 7: No pending URL means processPendingDeepLink is a no-op
console.log('Test 7: No pending URL is a no-op');
sentMessages.length = 0;
pendingDeepLinkUrl = null;
processPendingDeepLink();
assert.strictEqual(sentMessages.length, 0);
console.log('  PASS');

console.log('\nAll auth deep link tests passed.\n');
