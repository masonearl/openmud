const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const GMAIL_PROVIDER = 'gmail';
const MICROSOFT_PROVIDER = 'microsoft';
const APPLE_PROVIDER = 'apple_imap';

function env(name) {
  return String(process.env[name] || '').trim();
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const withPad = normalized + (padding ? '='.repeat(4 - padding) : '');
  return Buffer.from(withPad, 'base64').toString('utf8');
}

function base64UrlDecodeBuffer(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const withPad = normalized + (padding ? '='.repeat(4 - padding) : '');
  return Buffer.from(withPad, 'base64');
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return 'http://localhost:3000';
  return `${proto}://${host}`;
}

function getSupabaseConfig() {
  const url = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY') || env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  return { url, anonKey, serviceRoleKey };
}

function getAuthClient() {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error('Supabase auth is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).');
  }
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getAdminClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getUserFromRequest(req) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Authentication required. Sign in to use email tools.');
  const client = getAuthClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new Error('Invalid or expired session. Sign in again.');
  }
  return { user: data.user, accessToken: token };
}

function getTokenSecret() {
  const raw = env('EMAIL_TOKEN_SECRET') || env('OPENMUD_API_KEY') || '';
  if (!raw) {
    throw new Error('EMAIL_TOKEN_SECRET is required for encrypted token storage.');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptText(plainText) {
  const key = getTokenSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${base64UrlEncode(iv)}.${base64UrlEncode(tag)}.${base64UrlEncode(encrypted)}`;
}

function decryptText(payload) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload.');
  const iv = base64UrlDecodeBuffer(parts[0]);
  const tag = base64UrlDecodeBuffer(parts[1]);
  const data = base64UrlDecodeBuffer(parts[2]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getTokenSecret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function signState(payload) {
  const stateSecret = env('EMAIL_OAUTH_STATE_SECRET') || env('EMAIL_TOKEN_SECRET') || env('OPENMUD_API_KEY');
  if (!stateSecret) throw new Error('EMAIL_OAUTH_STATE_SECRET or EMAIL_TOKEN_SECRET is required.');
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', stateSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(stateValue) {
  const stateSecret = env('EMAIL_OAUTH_STATE_SECRET') || env('EMAIL_TOKEN_SECRET') || env('OPENMUD_API_KEY');
  if (!stateSecret) throw new Error('EMAIL_OAUTH_STATE_SECRET or EMAIL_TOKEN_SECRET is required.');
  const [body, sig] = String(stateValue || '').split('.');
  if (!body || !sig) throw new Error('Missing OAuth state.');
  const expected = crypto.createHmac('sha256', stateSecret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) throw new Error('Invalid OAuth state signature.');
  const isValid = crypto.timingSafeEqual(sigBuf, expectedBuf);
  if (!isValid) throw new Error('Invalid OAuth state signature.');
  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload?.exp || Date.now() > Number(payload.exp)) throw new Error('OAuth state expired. Try again.');
  return payload;
}

async function upsertEmailConnection({
  userId,
  provider,
  emailAddress,
  accessToken,
  refreshToken,
  tokenExpiresAt,
  scopes,
  meta,
}) {
  const admin = getAdminClient();
  const address = (emailAddress || '').trim() || null;
  const { data: existing, error: selectError } = await admin
    .from('email_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('email_address', address)
    .maybeSingle();
  if (selectError) throw selectError;

  const payload = {
    user_id: userId,
    provider,
    email_address: address,
    access_token_encrypted: encryptText(accessToken),
    refresh_token_encrypted: refreshToken ? encryptText(refreshToken) : null,
    token_expires_at: tokenExpiresAt || null,
    scopes: Array.isArray(scopes) ? scopes : [],
    meta: meta || {},
  };

  if (existing?.id) {
    const { error } = await admin.from('email_connections').update(payload).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data: inserted, error: insertError } = await admin
    .from('email_connections')
    .insert(payload)
    .select('id')
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}

async function logAudit(userId, action, provider, requestMeta) {
  const admin = getAdminClient();
  await admin.from('email_audit_log').insert({
    user_id: userId,
    action,
    provider,
    request_meta: requestMeta || {},
  });
}

async function getUserConnections(userId) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('email_connections')
    .select('id, provider, email_address, token_expires_at, scopes, created_at, updated_at, access_token_encrypted, refresh_token_encrypted, meta')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function pickConnection(userId, providerHint) {
  const all = await getUserConnections(userId);
  if (all.length === 0) {
    throw new Error('No connected email accounts. Connect Gmail or Outlook first.');
  }
  if (providerHint) {
    const match = all.find((c) => c.provider === providerHint);
    if (!match) throw new Error(`No connected account for provider '${providerHint}'.`);
    return match;
  }
  const preferred = all.find((c) => c.provider === GMAIL_PROVIDER) || all[0];
  return preferred;
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error_description || data?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function refreshIfNeeded(connection) {
  const provider = connection.provider;
  const accessToken = decryptText(connection.access_token_encrypted);
  const refreshToken = connection.refresh_token_encrypted ? decryptText(connection.refresh_token_encrypted) : '';
  const expiresAtMs = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  const stillValid = !expiresAtMs || (expiresAtMs - Date.now() > 60 * 1000);
  if (stillValid || !refreshToken) return { accessToken, refreshToken, tokenExpiresAt: connection.token_expires_at };

  if (provider === GMAIL_PROVIDER) {
    const body = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: env('GOOGLE_CLIENT_SECRET') || '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const tokenData = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + (Number(tokenData.expires_in) * 1000)).toISOString() : null;
    await upsertEmailConnection({
      userId: connection.user_id,
      provider,
      emailAddress: connection.email_address,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      tokenExpiresAt,
      scopes: String(tokenData.scope || '').split(' ').filter(Boolean),
      meta: connection.meta || {},
    });
    return { accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || refreshToken, tokenExpiresAt };
  }

  if (provider === MICROSOFT_PROVIDER) {
    const body = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID || '',
      client_secret: env('MICROSOFT_CLIENT_SECRET') || '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'offline_access Mail.Read Mail.Send User.Read',
    });
    const tokenData = await fetchJson('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + (Number(tokenData.expires_in) * 1000)).toISOString() : null;
    await upsertEmailConnection({
      userId: connection.user_id,
      provider,
      emailAddress: connection.email_address,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      tokenExpiresAt,
      scopes: String(tokenData.scope || '').split(' ').filter(Boolean),
      meta: connection.meta || {},
    });
    return { accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || refreshToken, tokenExpiresAt };
  }

  return { accessToken, refreshToken, tokenExpiresAt: connection.token_expires_at };
}

async function searchGmail(accessToken, args) {
  const queryParts = [];
  const query = String(args?.query || '').trim();
  if (query) queryParts.push(query);
  if (args?.from) queryParts.push(`from:${String(args.from).trim()}`);
  if (args?.subject) queryParts.push(`subject:${String(args.subject).trim()}`);
  if (args?.since) queryParts.push(`after:${String(args.since).trim()}`);
  const q = queryParts.join(' ').trim();
  const maxResults = Math.max(1, Math.min(20, Number(args?.limit) || 10));
  const data = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const results = [];
  for (const message of messages) {
    const item = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const headers = item?.payload?.headers || [];
    const from = (headers.find((h) => h.name === 'From') || {}).value || '';
    const subject = (headers.find((h) => h.name === 'Subject') || {}).value || '(no subject)';
    const date = (headers.find((h) => h.name === 'Date') || {}).value || '';
    results.push({
      id: item.id,
      thread_id: item.threadId,
      from,
      subject,
      snippet: item.snippet || '',
      date,
      provider: GMAIL_PROVIDER,
    });
  }
  return results;
}

function toMimeMessage(args) {
  const to = normalizeRecipients(args?.to).join(', ');
  const cc = normalizeRecipients(args?.cc);
  const bcc = normalizeRecipients(args?.bcc);
  const subject = String(args?.subject || '').trim();
  const body = String(args?.body || '').trim();
  const lines = [];
  lines.push(`To: ${to}`);
  if (cc.length > 0) lines.push(`Cc: ${cc.join(', ')}`);
  if (bcc.length > 0) lines.push(`Bcc: ${bcc.join(', ')}`);
  lines.push(`Subject: ${subject}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('');
  lines.push(body);
  return lines.join('\r\n');
}

async function sendGmail(accessToken, args) {
  const mime = toMimeMessage(args);
  const raw = Buffer.from(mime, 'utf8').toString('base64url');
  await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  return { status: 'sent', provider: GMAIL_PROVIDER };
}

async function searchMicrosoft(accessToken, args) {
  const top = Math.max(1, Math.min(20, Number(args?.limit) || 10));
  const query = String(args?.query || '').trim();
  const searchExpr = query ? `"${query.replace(/"/g, '\\"')}"` : '"*"';
  const url = `https://graph.microsoft.com/v1.0/me/messages?$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview`;
  const data = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: 'eventual',
    },
  });
  let items = Array.isArray(data.value) ? data.value : [];
  if (query) {
    const lower = query.toLowerCase();
    items = items.filter((m) => {
      const from = String(m?.from?.emailAddress?.address || '').toLowerCase();
      const subj = String(m?.subject || '').toLowerCase();
      const preview = String(m?.bodyPreview || '').toLowerCase();
      return from.includes(lower) || subj.includes(lower) || preview.includes(lower);
    });
  }
  return items.map((m) => ({
    id: m.id,
    from: m?.from?.emailAddress?.address || '',
    subject: m.subject || '(no subject)',
    snippet: m.bodyPreview || '',
    date: m.receivedDateTime || '',
    provider: MICROSOFT_PROVIDER,
  }));
}

async function sendMicrosoft(accessToken, args) {
  const toRecipients = normalizeRecipients(args?.to).map((email) => ({ emailAddress: { address: email } }));
  const ccRecipients = normalizeRecipients(args?.cc).map((email) => ({ emailAddress: { address: email } }));
  const bccRecipients = normalizeRecipients(args?.bcc).map((email) => ({ emailAddress: { address: email } }));
  await fetchJson('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: String(args?.subject || ''),
        body: { contentType: 'Text', content: String(args?.body || '') },
        toRecipients,
        ccRecipients,
        bccRecipients,
      },
      saveToSentItems: true,
    }),
  });
  return { status: 'sent', provider: MICROSOFT_PROVIDER };
}

async function searchEmailForUser(req, args) {
  const { user } = await getUserFromRequest(req);
  const providerHint = String(args?.provider || '').trim() || null;
  const connection = await pickConnection(user.id, providerHint);
  const refreshed = await refreshIfNeeded(connection);
  let results = [];
  if (connection.provider === GMAIL_PROVIDER) {
    results = await searchGmail(refreshed.accessToken, args);
  } else if (connection.provider === MICROSOFT_PROVIDER) {
    results = await searchMicrosoft(refreshed.accessToken, args);
  } else {
    throw new Error('Apple Mail search is not configured yet.');
  }
  await logAudit(user.id, 'search', connection.provider, {
    query: args?.query || '',
    limit: args?.limit || 10,
    provider: connection.provider,
    result_count: results.length,
  });
  return {
    provider: connection.provider,
    account: connection.email_address || '',
    results,
  };
}

async function sendEmailForUser(req, args) {
  const to = normalizeRecipients(args?.to);
  if (to.length === 0) {
    throw new Error('Missing recipient. Provide at least one "to" address.');
  }
  const subject = String(args?.subject || '').trim();
  const body = String(args?.body || '').trim();
  if (!subject || !body) {
    throw new Error('Missing subject or body.');
  }
  const { user } = await getUserFromRequest(req);
  const providerHint = String(args?.provider || '').trim() || null;
  const connection = await pickConnection(user.id, providerHint);
  const refreshed = await refreshIfNeeded(connection);
  let sent;
  if (connection.provider === GMAIL_PROVIDER) {
    sent = await sendGmail(refreshed.accessToken, args);
  } else if (connection.provider === MICROSOFT_PROVIDER) {
    sent = await sendMicrosoft(refreshed.accessToken, args);
  } else {
    throw new Error('Apple Mail sending is not configured yet.');
  }
  await logAudit(user.id, 'send', connection.provider, {
    to,
    subject,
    provider: connection.provider,
  });
  return sent;
}

async function buildProviderAuthUrl(req, userId, provider, returnTo) {
  const baseUrl = getBaseUrl(req);
  const callback = `${baseUrl}/api/email/oauth/callback`;
  const nonce = crypto.randomBytes(12).toString('hex');
  const state = signState({
    user_id: userId,
    provider,
    return_to: returnTo || '/pages/chat.html',
    nonce,
    exp: Date.now() + (10 * 60 * 1000),
  });

  if (provider === GMAIL_PROVIDER) {
    const clientId = env('GOOGLE_CLIENT_ID');
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured.');
    const scope = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' ');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope,
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  if (provider === MICROSOFT_PROVIDER) {
    const clientId = env('MICROSOFT_CLIENT_ID');
    if (!clientId) throw new Error('MICROSOFT_CLIENT_ID is not configured.');
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: callback,
      response_mode: 'query',
      scope: 'offline_access Mail.Read Mail.Send User.Read',
      state,
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  throw new Error('Unsupported provider.');
}

async function handleOAuthCallback(req) {
  const baseUrl = getBaseUrl(req);
  const callback = `${baseUrl}/api/email/oauth/callback`;
  const code = String(req.query?.code || '');
  const error = String(req.query?.error || '');
  const stateRaw = String(req.query?.state || '');
  if (error) {
    return { ok: false, message: `OAuth failed: ${error}`, redirectTo: '/pages/chat.html?email_connected=error' };
  }
  if (!code || !stateRaw) {
    return { ok: false, message: 'Missing OAuth code/state.', redirectTo: '/pages/chat.html?email_connected=error' };
  }

  const state = verifyState(stateRaw);
  const provider = state.provider;
  const userId = state.user_id;
  const returnTo = String(state.return_to || '/pages/chat.html');

  if (!userId || !provider) {
    return { ok: false, message: 'Invalid OAuth state payload.', redirectTo: '/pages/chat.html?email_connected=error' };
  }

  if (provider === GMAIL_PROVIDER) {
    const tokenBody = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID') || '',
      client_secret: env('GOOGLE_CLIENT_SECRET') || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: callback,
    });
    const tokenData = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const profile = await fetchJson('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const expiresAt = tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null;
    await upsertEmailConnection({
      userId,
      provider,
      emailAddress: profile.email || '',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      tokenExpiresAt: expiresAt,
      scopes: String(tokenData.scope || '').split(' ').filter(Boolean),
      meta: { connected_via: 'oauth' },
    });
    await logAudit(userId, 'connect', provider, { email: profile.email || '' });
    return { ok: true, message: 'Gmail connected.', redirectTo: `${returnTo}?email_connected=gmail` };
  }

  if (provider === MICROSOFT_PROVIDER) {
    const tokenBody = new URLSearchParams({
      client_id: env('MICROSOFT_CLIENT_ID') || '',
      client_secret: env('MICROSOFT_CLIENT_SECRET') || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: callback,
      scope: 'offline_access Mail.Read Mail.Send User.Read',
    });
    const tokenData = await fetchJson('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const profile = await fetchJson('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const emailAddress = profile.mail || profile.userPrincipalName || '';
    const expiresAt = tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null;
    await upsertEmailConnection({
      userId,
      provider,
      emailAddress,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      tokenExpiresAt: expiresAt,
      scopes: String(tokenData.scope || '').split(' ').filter(Boolean),
      meta: { connected_via: 'oauth' },
    });
    await logAudit(userId, 'connect', provider, { email: emailAddress });
    return { ok: true, message: 'Outlook connected.', redirectTo: `${returnTo}?email_connected=microsoft` };
  }

  return { ok: false, message: 'Unsupported provider.', redirectTo: '/pages/chat.html?email_connected=error' };
}

function toPublicConnection(connection) {
  return {
    id: connection.id,
    provider: connection.provider,
    email_address: connection.email_address,
    token_expires_at: connection.token_expires_at,
    scopes: connection.scopes || [],
    created_at: connection.created_at,
    updated_at: connection.updated_at,
  };
}

module.exports = {
  GMAIL_PROVIDER,
  MICROSOFT_PROVIDER,
  APPLE_PROVIDER,
  getUserFromRequest,
  getUserConnections,
  toPublicConnection,
  buildProviderAuthUrl,
  handleOAuthCallback,
  searchEmailForUser,
  sendEmailForUser,
};
