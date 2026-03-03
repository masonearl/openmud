(function () {
  'use strict';

  var _configPromise = null;
  // Cache the client promise (not just the client) to prevent the race condition
  // where multiple getClient() calls resolve before _client is set, each calling
  // createClient() and producing the "Multiple GoTrueClient instances" warning.
  var _clientPromise = null;

  function getApiBase() {
    var isDesktopApp = /mudrag-desktop/i.test(navigator.userAgent || '');
    var isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    var search = window.location.search || '';
    var m = search.match(/[?&]toolPort=(\d+)/);
    var port = m ? m[1] : ((isDesktopApp || isLocal) ? '3847' : null);
    var useDesktop = /[?&]useDesktopApi=1/.test(search) || isDesktopApp || isLocal;
    if (useDesktop && port) return 'http://127.0.0.1:' + port + '/api';
    return '/api';
  }

  function getConfig() {
    if (!_configPromise) {
      _configPromise = fetch(getApiBase() + '/config')
        .then(function (r) {
          if (!r.ok) return { supabaseUrl: '', supabaseAnonKey: '' };
          return r.text().then(function (text) {
            try {
              return JSON.parse(text);
            } catch (e) {
              return { supabaseUrl: '', supabaseAnonKey: '' };
            }
          });
        })
        .catch(function () {
          return { supabaseUrl: '', supabaseAnonKey: '' };
        });
    }
    return _configPromise;
  }

  function getClient() {
    if (!_clientPromise) {
      _clientPromise = getConfig().then(function (c) {
        if (!c.supabaseUrl || !c.supabaseAnonKey) return null;
        var sb = typeof supabase !== 'undefined' ? supabase : (typeof window !== 'undefined' && window.supabase);
        if (!sb) return null;
        var createClient = sb.createClient || (sb.default && sb.default.createClient);
        if (!createClient) return null;
        return createClient(c.supabaseUrl, c.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
      });
    }
    return _clientPromise;
  }

  // Always redirect to the canonical domain after auth so the Supabase session
  // is stored under a single localStorage origin. www.openmud.ai and openmud.ai
  // have separate localStorage, causing "signed in on settings, not on dashboard"
  // bugs if the session was created on the other subdomain.
  function getRedirectUrl() {
    if (typeof window !== 'undefined' && window.location) {
      var host = window.location.hostname || '';
      if (host === 'localhost' || host === '127.0.0.1') {
        return window.location.origin + '/welcome.html';
      }
    }
    return 'https://openmud.ai/welcome.html';
  }

  // When the desktop app receives a openmud://auth deep link it forwards the
  // tokens here via IPC so we can restore the session without re-authenticating.
  function initDesktopAuthBridge() {
    if (typeof window === 'undefined' || !window.mudragDesktop || !window.mudragDesktop.onAuthCallback) return;
    window.mudragDesktop.onAuthCallback(function (data) {
      if (!data || !data.access_token || !data.refresh_token) return;
      getClient().then(function (client) {
        if (!client) return;
        client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token })
          .catch(function (e) { console.warn('[mudrag] auth bridge setSession failed', e); });
      });
    });
  }

  // Run after DOM is ready so mudragDesktop is available
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDesktopAuthBridge);
    } else {
      initDesktopAuthBridge();
    }
  }

  window.mudragAuth = {
    signInWithEmail: function (email) {
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured'));
        return client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: getRedirectUrl() } });
      });
    },
    signInWithGoogle: function () {
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured'));
        return client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: getRedirectUrl() } });
      });
    },
    signInWithApple: function () {
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured'));
        return client.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: getRedirectUrl() } });
      });
    },
    signOut: function () {
      return getClient().then(function (client) {
        if (!client) return Promise.resolve();
        return client.auth.signOut();
      });
    },
    getSession: function () {
      return getClient().then(function (client) {
        if (!client) return { data: { session: null }, error: null };
        return client.auth.getSession();
      });
    },
    onAuthStateChange: function (cb) {
      getClient().then(function (client) {
        if (!client) return;
        client.auth.onAuthStateChange(cb);
      });
    },
  };
})();
