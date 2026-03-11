(function () {
  'use strict';

  var _configPromise = null;
  var STORAGE_AUTH_USER_ID = 'openmud_auth_user_id_v1';
  // Cache the client promise (not just the client) to prevent the race condition
  // where multiple getClient() calls resolve before _client is set, each calling
  // createClient() and producing the "Multiple GoTrueClient instances" warning.
  var _clientPromise = null;

  function getApiBase() {
    var isDesktopApp = /mudrag-desktop/i.test(navigator.userAgent || '');
    var search = window.location.search || '';
    var m = search.match(/[?&]toolPort=(\d+)/);
    var port = m ? m[1] : (isDesktopApp ? '3847' : null);
    var useDesktop = /[?&]useDesktopApi=1/.test(search) || isDesktopApp;
    if (useDesktop && port) {
      return 'http://127.0.0.1:' + port + '/api';
    }
    return '/api';
  }

  function getDesktopPortCandidates(preferredPort) {
    var seen = {};
    var values = [];
    function pushPort(value) {
      var str = String(value || '').trim();
      if (!/^\d+$/.test(str) || seen[str]) return;
      seen[str] = true;
      values.push(str);
    }
    pushPort(preferredPort);
    pushPort((window.location.search || '').match(/[?&]toolPort=(\d+)/) && RegExp.$1);
    ['3847', '3848', '3849', '3850'].forEach(pushPort);
    return values;
  }

  function readStoredAuthUserId() {
    try {
      return String(window.localStorage.getItem(STORAGE_AUTH_USER_ID) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function writeStoredAuthUserId(userId) {
    try {
      var value = String(userId || '').trim();
      if (value) window.localStorage.setItem(STORAGE_AUTH_USER_ID, value);
      else window.localStorage.removeItem(STORAGE_AUTH_USER_ID);
    } catch (e) {
      // ignore storage failures
    }
  }

  function getScopedStorageKey(baseKey, options) {
    var base = String(baseKey || '').trim();
    if (!base) return '';
    var opts = options || {};
    if (opts.unscoped) return base;
    var userId = String(opts.userId != null ? opts.userId : readStoredAuthUserId()).trim();
    return userId ? (base + '::user::' + userId) : base;
  }

  function buildDesktopAppUrl(nextPath, port) {
    var safeNext = String(nextPath || '/try').trim();
    if (!safeNext || safeNext.charAt(0) !== '/') safeNext = '/try';
    var query = [];
    if (port) query.push('toolPort=' + encodeURIComponent(String(port)));
    query.push('useDesktopApi=1');
    return 'openmud://' + safeNext.replace(/^\//, '') + (query.length ? ('?' + query.join('&')) : '');
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { ok: !!res.ok, status: res.status, data: data || {} };
      });
    }).catch(function () {
      return { ok: false, status: 0, data: null };
    });
  }

  function devSignIn(token, email, nextPath) {
    return getRedirectUrl().then(function () {
      var next = String(nextPath || getSafeReturnPath() || '/try').trim();
      return fetch(getApiBase() + '/dev-signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: String(token || '').trim(),
          email: String(email || '').trim(),
          next: next
        })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error((data && data.error) || 'Dev sign in failed.');
            err.status = res.status;
            throw err;
          }
          var actionLink = data && data.action_link ? String(data.action_link) : '';
          if (!actionLink) throw new Error('Missing dev auth link.');
          launchAuthUrl(actionLink);
          return data;
        });
      });
    });
  }

  function requestDesktopAuthHandoff(options) {
    var opts = options || {};
    if (isDesktopApp() && window.mudragDesktop && window.mudragDesktop.beginAuthHandoff) {
      return window.mudragDesktop.beginAuthHandoff({ nextPath: opts.nextPath || '/try' })
        .catch(function () { return null; });
    }
    var ports = getDesktopPortCandidates(opts.port);
    return ports.reduce(function (promise, port) {
      return promise.then(function (result) {
        if (result && result.ok && result.requestId) return result;
        return postJson('http://127.0.0.1:' + port + '/api/desktop-auth/start', {
          nextPath: opts.nextPath || '/try'
        }).then(function (response) {
          if (!response.ok || !response.data || !response.data.requestId) return null;
          return {
            ok: true,
            requestId: response.data.requestId,
            port: response.data.port || port,
            expiresAt: response.data.expiresAt || null
          };
        });
      });
    }, Promise.resolve(null));
  }

  function deliverSessionToDesktop(session, options) {
    var opts = options || {};
    if (!session || !session.access_token || !session.refresh_token || !opts.requestId) {
      return Promise.resolve({ ok: false, delivered: false });
    }
    var port = String(opts.port || '').trim();
    if (!/^\d+$/.test(port)) return Promise.resolve({ ok: false, delivered: false });
    return postJson('http://127.0.0.1:' + port + '/api/desktop-auth/complete', {
      requestId: opts.requestId,
      access_token: session.access_token,
      refresh_token: session.refresh_token
    }).then(function (response) {
      return {
        ok: !!(response && response.ok),
        delivered: !!(response && response.ok),
        port: port,
        launchUrl: buildDesktopAppUrl(opts.nextPath || '/try', port)
      };
    });
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

  function getSafeReturnPath() {
    if (typeof window === 'undefined' || !window.location) return '/try';
    var path = window.location.pathname || '/';
    // Avoid redirect loops through the auth landing page.
    if (/^\/welcome(?:\.html)?$/i.test(path)) return '/try';
    var search = window.location.search || '';
    var hash = window.location.hash || '';
    var full = path + search + hash;
    return full && full.charAt(0) === '/' ? full : '/try';
  }

  function isDesktopApp() {
    return typeof window !== 'undefined'
      && !!window.mudragDesktop
      && /mudrag-desktop/i.test(navigator.userAgent || '');
  }

  function buildAuthLandingUrl() {
    var nextPath = getSafeReturnPath();
    var base;
    if (typeof window !== 'undefined' && window.location) {
      var host = window.location.hostname || '';
      if (host === 'localhost' || host === '127.0.0.1') {
        base = window.location.origin + '/welcome.html';
      } else {
        base = 'https://openmud.ai/welcome.html';
      }
    } else {
      base = 'https://openmud.ai/welcome.html';
    }
    return requestDesktopAuthHandoff({ nextPath: nextPath }).then(function (handoff) {
      var params = ['next=' + encodeURIComponent(nextPath)];
      if (handoff && handoff.requestId) {
        params.push('desktop=1');
        params.push('desktopRequestId=' + encodeURIComponent(handoff.requestId));
        if (handoff.port) params.push('desktopPort=' + encodeURIComponent(String(handoff.port)));
      } else if (isDesktopApp()) {
        params.push('desktop=1');
      }
      return base + '?' + params.join('&');
    });
  }

  function persistAuthNextPath(nextPath) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('mudrag_auth_next', nextPath || '/try');
    } catch (e) {
      // ignore storage errors
    }
  }

  // Always redirect to a single callback page so Supabase can finalize auth,
  // then bounce back to the original page via localStorage.
  function getRedirectUrl() {
    persistAuthNextPath(getSafeReturnPath());
    return buildAuthLandingUrl();
  }

  function launchAuthUrl(url) {
    if (!url || typeof window === 'undefined') return;
    if (isDesktopApp() && window.mudragDesktop && window.mudragDesktop.openExternal) {
      window.mudragDesktop.openExternal(url);
      return;
    }
    if (window.location) window.location.assign(url);
  }

  function getPostAuthDesktopPath() {
    var fallback = '/try';
    try {
      var stored = window.localStorage.getItem('mudrag_auth_next') || '';
      if (stored && stored.charAt(0) === '/' && !/^\/welcome(?:\.html)?(?:[?#]|$)/i.test(stored)) {
        return stored;
      }
    } catch (e) {}
    if (typeof window !== 'undefined' && window.location) {
      var currentPath = (window.location.pathname || '/') + (window.location.search || '');
      var currentSearch = window.location.search || '';
      var desktopQuery = currentSearch ? currentSearch.replace(/^\?/, '') : '';
      if (desktopQuery) fallback += '?' + desktopQuery;
      if (/^\/(welcome(?:\.html)?|settings(?:\.html)?)$/i.test(window.location.pathname || '')) {
        return fallback;
      }
      if (currentPath && currentPath.charAt(0) === '/') return currentPath;
    }
    return fallback;
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
          .then(function () {
            var nextPath = getPostAuthDesktopPath();
            if (window.location && nextPath && (window.location.pathname + window.location.search !== nextPath)) {
              window.location.replace(nextPath);
            }
          })
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

  getClient().then(function (client) {
    if (!client || !client.auth) return;
    client.auth.getSession().then(function (result) {
      var session = result && result.data ? result.data.session : null;
      writeStoredAuthUserId(session && session.user ? session.user.id : '');
    }).catch(function () {});
    client.auth.onAuthStateChange(function (_event, session) {
      writeStoredAuthUserId(session && session.user ? session.user.id : '');
    });
  });

  window.mudragAuth = {
    signInWithEmail: function (email) {
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured. Missing SUPABASE_URL / SUPABASE_ANON_KEY.'));
        return getRedirectUrl().then(function (redirectTo) {
          return client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } });
        });
      });
    },
    signInWithGoogle: function () {
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured. Missing SUPABASE_URL / SUPABASE_ANON_KEY.'));
        return getRedirectUrl().then(function (redirectTo) {
          return client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: redirectTo, skipBrowserRedirect: true }
          }).then(function (result) {
            var oauthUrl = result && result.data && result.data.url;
            launchAuthUrl(oauthUrl);
            return result;
          });
        });
      });
    },
    signInWithApple: function () {
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured. Missing SUPABASE_URL / SUPABASE_ANON_KEY.'));
        return getRedirectUrl().then(function (redirectTo) {
          return client.auth.signInWithOAuth({
            provider: 'apple',
            options: { redirectTo: redirectTo, skipBrowserRedirect: true }
          }).then(function (result) {
            var oauthUrl = result && result.data && result.data.url;
            launchAuthUrl(oauthUrl);
            return result;
          });
        });
      });
    },
    devSignIn: devSignIn,
    signOut: function () {
      return getClient().then(function (client) {
        if (!client) return Promise.resolve();
        writeStoredAuthUserId('');
        return client.auth.signOut();
      });
    },
    getSession: function () {
      return getClient().then(function (client) {
        if (!client) return { data: { session: null }, error: null };
        return client.auth.getSession().then(function (result) {
          var session = result && result.data ? result.data.session : null;
          writeStoredAuthUserId(session && session.user ? session.user.id : '');
          return result;
        });
      });
    },
    onAuthStateChange: function (cb) {
      getClient().then(function (client) {
        if (!client) return;
        client.auth.onAuthStateChange(function (event, session) {
          writeStoredAuthUserId(session && session.user ? session.user.id : '');
          cb(event, session);
        });
      });
    },
    getScopedStorageKey: getScopedStorageKey,
    requestDesktopAuthHandoff: requestDesktopAuthHandoff,
    deliverSessionToDesktop: deliverSessionToDesktop,
    buildDesktopAppUrl: buildDesktopAppUrl,
  };
})();
