const crypto = require('crypto');

function env(name) {
  return String(process.env[name] || '').trim();
}

function getTokenSecret() {
  const raw = env('OPENMUD_SESSION_SECRET')
    || env('EMAIL_TOKEN_SECRET');
  if (!raw) {
    throw new Error('OPENMUD_SESSION_SECRET or EMAIL_TOKEN_SECRET is required.');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeBuffer(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const withPad = normalized + (padding ? '='.repeat(4 - padding) : '');
  return Buffer.from(withPad, 'base64');
}

function encryptText(plainText) {
  const key = getTokenSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText || ''), 'utf8'), cipher.final()]);
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

function generateOpaqueCode() {
  return crypto.randomBytes(24).toString('base64url');
}

function hashOpaqueCode(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

module.exports = {
  encryptText,
  decryptText,
  generateOpaqueCode,
  hashOpaqueCode,
};
