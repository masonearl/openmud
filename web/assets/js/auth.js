(function () {
  'use strict';

  var _configPromise = null;
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

  function getAccountState() {
    return (typeof window !== 'undefined' && window.openmudAccountState) ? window.openmudAccountState : null;
  }

  function logAuthEvent(eventName, details) {
    try {
      var accountState = getAccountState();
      console.log(JSON.stringify(Object.assign({
        event: eventName,
        source: 'web-auth',
        user_id: accountState && accountState.getCurrentUserId ? accountState.getCurrentUserId() : 'anon',
        at: new Date().toISOString()
      }, details || {})));
    } catch (e) {}
  }

  function syncDesktopAccountContext(session) {
    if (typeof window === 'undefined' || !window.mudragDesktop || !window.mudragDesktop.setActiveAccount) return Promise.resolve();
    var user = session && session.user ? session.user : null;
    return window.mudragDesktop.setActiveAccount({
      userId: user && user.id ? user.id : '',
      email: user && user.email ? user.email : ''
    }).catch(function () {
      return { ok: false };
    });
  }

  function syncAccountScope(session) {
    var accountState = getAccountState();
    if (accountState && typeof accountState.setActiveUser === 'function') {
      accountState.setActiveUser(session || null);
    }
    return syncDesktopAccountContext(session);
  }

  function readJsonResponse(resp) {
    if (!resp) return Promise.resolve(null);
    return resp.text().then(function (text) {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (e) {
        return { error: 'Unexpected server response.' };
      }
    }).catch(function () {
      return null;
    });
  }

  function createDesktopHandoff(session) {
    if (!session || !session.access_token || !session.refresh_token) {
      return Promise.reject(new Error('You need to sign in before opening the desktop app.'));
    }
    logAuthEvent('desktop_handoff_start_requested');
    return fetch(getApiBase() + '/desktop-handoff/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token
      },
      body: JSON.stringify({
        refresh_token: session.refresh_token
      })
    }).then(function (resp) {
      return readJsonResponse(resp).then(function (data) {
        if (!resp.ok) {
          throw new Error((data && data.error) || 'Could not prepare desktop sign-in.');
        }
        if (!data || !data.handoff_code) {
          throw new Error('Desktop handoff was not created.');
        }
        logAuthEvent('desktop_handoff_start_completed', {
          expires_at: data.expires_at || null
        });
        return data;
      });
    }).catch(function (err) {
      logAuthEvent('desktop_handoff_start_failed', {
        message: err && err.message ? err.message : 'unknown_error'
      });
      throw err;
    });
  }

  function redeemDesktopHandoff(handoffCode) {
    var code = String(handoffCode || '').trim();
    if (!code) return Promise.reject(new Error('Missing desktop handoff code.'));
    logAuthEvent('desktop_handoff_redeem_requested');
    return fetch(getApiBase() + '/desktop-handoff/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoff_code: code })
    }).then(function (resp) {
      return readJsonResponse(resp).then(function (data) {
        if (!resp.ok) {
          throw new Error((data && data.error) || 'Desktop sign-in failed.');
        }
        if (!data || !data.access_token || !data.refresh_token) {
          throw new Error('Desktop sign-in response was incomplete.');
        }
        logAuthEvent('desktop_handoff_redeem_completed');
        return data;
      });
    }).catch(function (err) {
      logAuthEvent('desktop_handoff_redeem_failed', {
        message: err && err.message ? err.message : 'unknown_error'
      });
      throw err;
    });
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
      if (!data) return;
      if (data.handoff_code) {
        redeemDesktopHandoff(data.handoff_code).then(function (tokens) {
          return getClient().then(function (client) {
            if (!client) return null;
            return client.auth.setSession({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token
            });
          });
        }).catch(function (e) {
          console.warn('[mudrag] desktop handoff redeem failed', e);
        });
        return;
      }
      if (!data.access_token || !data.refresh_token) return;
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
      logAuthEvent('auth_signin_email_started');
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured. Missing SUPABASE_URL / SUPABASE_ANON_KEY.'));
        return client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: getRedirectUrl() } })
          .then(function (result) {
            logAuthEvent(result && result.error ? 'auth_signin_email_failed' : 'auth_signin_email_completed', {
              message: result && result.error ? result.error.message || 'unknown_error' : null
            });
            return result;
          });
      });
    },
    signInWithGoogle: function () {
      logAuthEvent('auth_signin_google_started');
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured. Missing SUPABASE_URL / SUPABASE_ANON_KEY.'));
        var redirectTo = getRedirectUrl();
        return client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: redirectTo, skipBrowserRedirect: true }
        }).then(function (result) {
          var oauthUrl = result && result.data && result.data.url;
          if (oauthUrl && typeof window !== 'undefined' && window.location) {
            logAuthEvent('auth_signin_google_redirect_ready');
            window.location.assign(oauthUrl);
          }
          if (result && result.error) {
            logAuthEvent('auth_signin_google_failed', { message: result.error.message || 'unknown_error' });
          }
          return result;
        });
      });
    },
    signInWithApple: function () {
      logAuthEvent('auth_signin_apple_started');
      return getClient().then(function (client) {
        if (!client) return Promise.reject(new Error('Auth not configured. Missing SUPABASE_URL / SUPABASE_ANON_KEY.'));
        var redirectTo = getRedirectUrl();
        return client.auth.signInWithOAuth({
          provider: 'apple',
          options: { redirectTo: redirectTo, skipBrowserRedirect: true }
        }).then(function (result) {
          var oauthUrl = result && result.data && result.data.url;
          if (oauthUrl && typeof window !== 'undefined' && window.location) {
            logAuthEvent('auth_signin_apple_redirect_ready');
            window.location.assign(oauthUrl);
          }
          if (result && result.error) {
            logAuthEvent('auth_signin_apple_failed', { message: result.error.message || 'unknown_error' });
          }
          return result;
        });
      });
    },
    signOut: function () {
      return getClient().then(function (client) {
        if (!client) {
          return syncAccountScope(null).then(function () {
            logAuthEvent('auth_signout_completed');
            return null;
          });
        }
        return client.auth.signOut().then(function (result) {
          return syncAccountScope(null).then(function () {
            logAuthEvent('auth_signout_completed');
            return result;
          });
        }).catch(function (err) {
          return syncAccountScope(null).then(function () {
            logAuthEvent('auth_signout_failed', {
              message: err && err.message ? err.message : 'unknown_error'
            });
            throw err;
          });
        });
      });
    },
    getSession: function () {
      return getClient().then(function (client) {
        if (!client) {
          return syncAccountScope(null).then(function () {
            return { data: { session: null }, error: null };
          });
        }
        return client.auth.getSession().then(function (result) {
          var session = result && result.data ? result.data.session : null;
          return syncAccountScope(session).then(function () {
            logAuthEvent('auth_session_loaded', {
              signed_in: !!(session && session.user)
            });
            return result;
          });
        });
      });
    },
    onAuthStateChange: function (cb) {
      getClient().then(function (client) {
        if (!client) return;
        client.auth.onAuthStateChange(function (event, session) {
          syncAccountScope(session).then(function () {
            logAuthEvent('auth_state_changed', {
              auth_event: event || '',
              signed_in: !!(session && session.user)
            });
            cb(event, session);
          });
        });
      });
    },
    createDesktopHandoff: createDesktopHandoff
  };

  window.mudragAuthReady = window.mudragAuth.getSession()
    .then(function (result) { return result; })
    .catch(function () {
      return { data: { session: null }, error: null };
    });
})();
