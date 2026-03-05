#!/usr/bin/env node
/**
 * openmud-agent — bridges openmud.ai chat to your Mac.
 *
 * Self-updating: checks GitHub for a new version on startup and every hour.
 * If a newer version is found it downloads it, replaces itself, and restarts.
 *
 * Usage:
 *   node openmud-agent.js --token <your-token>
 *
 * Get your token from: openmud.ai → Settings → OpenClaw Agent
 */

'use strict';

const { WebSocket } = require('ws');
const { execFile, exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Self-update ─────────────────────────────────────────────────────────────

const AGENT_URL = 'https://raw.githubusercontent.com/masonearl/openmud/main/relay/openmud-agent.js';
const SELF = path.resolve(__filename);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'openmud-agent' } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function checkForUpdate() {
  try {
    const latest = await fetchText(AGENT_URL);
    const current = fs.readFileSync(SELF, 'utf8');
    if (latest.trim() === current.trim()) return; // already up to date
    console.log('[openmud-agent] New version found. Updating and restarting...');
    fs.writeFileSync(SELF, latest, 'utf8');
    // Re-launch with the same args and exit this process
    const child = spawn(process.execPath, process.argv.slice(1), {
      detached: true,
      stdio: 'inherit',
    });
    child.unref();
    process.exit(0);
  } catch (e) {
    // Non-fatal — keep running on current version
  }
}

// Check on startup, then every hour
checkForUpdate();
setInterval(checkForUpdate, 60 * 60 * 1000);

// ── Args ───────────────────────────────────────────────────────────────────

const args = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] !== undefined && !String(arr[i + 1]).startsWith('--') ? arr[i + 1] : true;
});

const TOKEN = args.token;
const RELAY_URL = (args.relay || 'wss://openmud-production.up.railway.app').replace(/^http/, 'ws').replace(/\/+$/, '');

if (!TOKEN) {
  console.error('\nError: --token is required.');
  console.error('Get your token from: openmud.ai → Settings → OpenClaw Agent\n');
  console.error('Usage: node openmud-agent.js --token <your-token>\n');
  process.exit(1);
}

const isMac = os.platform() === 'darwin';

// ── Command executor ───────────────────────────────────────────────────────

/**
 * Run an osascript (AppleScript) string on this Mac.
 */
function runAppleScript(script, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    if (!isMac) return reject(new Error('AppleScript only runs on macOS.'));
    execFile('/usr/bin/osascript', ['-e', script], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve((stdout || '').trim());
    });
  });
}

/**
 * Run a shell command.
 */
function runShell(cmd, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve((stdout || '').trim());
    });
  });
}

// ── Command handlers ───────────────────────────────────────────────────────
// The server sends { type, ...params }. Each handler returns a human-readable result string.

async function handleCalendarAdd(params) {
  const { title, date, time, durationMinutes, location, calendarName, reminderMinutes } = params;
  if (!title || !date) throw new Error('Missing title or date for calendar event.');

  const d = new Date(date + (time ? 'T' + time : 'T12:00:00'));
  if (isNaN(d)) throw new Error('Invalid date: ' + date);

  const end = new Date(d.getTime() + (durationMinutes || 60) * 60000);
  const cal = calendarName || 'WORK';
  const reminder = reminderMinutes != null ? reminderMinutes : 15;
  const loc = location || '';

  const script = `
tell application "Calendar"
  set targetCal to missing value
  repeat with c in calendars
    if name of c is "${cal.replace(/"/g, '\\"')}" then
      set targetCal to c
      exit repeat
    end if
  end repeat
  if targetCal is missing value then
    repeat with c in calendars
      if (name of c) as string is equal to "${cal.replace(/"/g, '\\"')}" then
        set targetCal to c
        exit repeat
      end if
    end repeat
  end if
  if targetCal is missing value then set targetCal to first calendar
  set startDate to current date
  set year of startDate to ${d.getFullYear()}
  set month of startDate to ${d.getMonth() + 1}
  set day of startDate to ${d.getDate()}
  set hours of startDate to ${d.getHours()}
  set minutes of startDate to ${d.getMinutes()}
  set seconds of startDate to 0
  set endDate to current date
  set year of endDate to ${end.getFullYear()}
  set month of endDate to ${end.getMonth() + 1}
  set day of endDate to ${end.getDate()}
  set hours of endDate to ${end.getHours()}
  set minutes of endDate to ${end.getMinutes()}
  set seconds of endDate to 0
  set newEvent to make new event at end of events of targetCal with properties {summary:"${title.replace(/"/g, '\\"')}", start date:startDate, end date:endDate${loc ? ', location:"' + loc.replace(/"/g, '\\"') + '"' : ''}}
  ${reminder >= 0 ? `make new display alarm at end of display alarms of newEvent with properties {trigger interval:${-Math.abs(reminder)}}` : ''}
  save
end tell
"ok"`;

  await runAppleScript(script, 45000);
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Added to Apple Calendar.\nEvent: ${title}\nDate: ${dateStr}\nTime: ${timeStr}${loc ? '\nLocation: ' + loc : ''}\nCalendar: ${cal}\nReminder: ${reminder} min before`;
}

async function handleCalendarDelete(params) {
  const { title, date, calendarName } = params;
  if (!title) throw new Error('Missing event title to delete.');

  const cal = calendarName || null;
  let dateFilter = '';
  if (date) {
    const d = new Date(date);
    if (!isNaN(d)) {
      dateFilter = `
  set startOfDay to current date
  set year of startOfDay to ${d.getFullYear()}
  set month of startOfDay to ${d.getMonth() + 1}
  set day of startOfDay to ${d.getDate()}
  set hours of startOfDay to 0
  set minutes of startOfDay to 0
  set seconds of startOfDay to 0
  set endOfDay to startOfDay + 86400`;
    }
  }

  const script = `
tell application "Calendar"
  set deletedCount to 0
  set titleLower to "${title.toLowerCase().replace(/"/g, '\\"')}"
  repeat with c in calendars
    ${cal ? `if name of c is "${cal.replace(/"/g, '\\"')}" then` : ''}
    ${dateFilter || `
  set startOfDay to (current date) - (30 * days)
  set endOfDay to (current date) + (60 * days)`}
    set evts to (get events of c whose start date >= startOfDay and start date <= endOfDay)
    repeat with e in evts
      set evtTitle to summary of e
      if evtTitle contains "${title.replace(/"/g, '\\"')}" then
        delete e
        set deletedCount to deletedCount + 1
      end if
    end repeat
    ${cal ? 'end if' : ''}
  end repeat
  return deletedCount as string
end tell`;

  const count = await runAppleScript(script, 45000);
  const n = parseInt(count || '0', 10);
  if (n === 0) return `No event matching "${title}" found in your calendar.`;
  return `Deleted ${n} event${n > 1 ? 's' : ''} matching "${title}" from your calendar.`;
}

async function handleEmailSend(params) {
  const { to, subject, body } = params;
  if (!to || !subject || !body) throw new Error('Missing to, subject, or body for email.');

  // If `to` is a name (not an email address), resolve via Contacts + Messages recency
  let recipient = to;
  let resolvedName = to;
  const isEmail = to.includes('@');
  if (!isEmail) {
    const contact = await resolveContact(to);
    if (contact.ambiguous) return contact.question;
    // For email, we need an email address specifically — re-check if handle is a phone
    if (contact.resolved && contact.resolved.includes('@')) {
      recipient = contact.resolved;
      resolvedName = contact.name || to;
    } else {
      // resolveContact returned a phone — look specifically for email address
      const emailScript = `
tell application "Contacts"
  set matches to (every person whose name contains "${to.replace(/"/g, '\\"')}")
  repeat with p in matches
    if (count of emails of p) > 0 then
      return value of item 1 of emails of p
    end if
  end repeat
  return ""
end tell`;
      try {
        const found = await runAppleScript(emailScript, 10000);
        if (found && found.trim()) { recipient = found.trim(); resolvedName = contact.name || to; }
        else throw new Error(`No email address found for "${to}" in your Contacts.`);
      } catch (e) { throw new Error(`Could not find email for "${to}": ${e.message}`); }
    }
  }

  const script = `
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"${subject.replace(/"/g, '\\"')}", content:"${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}
  tell newMsg
    make new to recipient at end of to recipients with properties {address:"${recipient.replace(/"/g, '\\"')}"}
  end tell
  send newMsg
end tell
"sent"`;

  await runAppleScript(script, 30000);
  return `Email sent.\nTo: ${resolvedName}${recipient !== resolvedName ? ' <' + recipient + '>' : ''}\nSubject: ${subject}\nBody: ${body.slice(0, 120)}${body.length > 120 ? '...' : ''}`;
}

/**
 * Resolve a name to the best matching contact handle (phone or email).
 * Strategy:
 *   1. If input already looks like a phone/email → use as-is.
 *   2. Search Contacts for all people whose name contains the query.
 *   3. If exactly one match → use it.
 *   4. If multiple → ask the user immediately (no hanging DB queries).
 */
async function resolveContact(name) {
  const isPhoneOrEmail = /^\+?[\d\s\-().]{7,}$/.test(name) || name.includes('@');
  if (isPhoneOrEmail) return { resolved: name };

  const lookupScript = `
tell application "Contacts"
  set out to ""
  set matches to (every person whose name contains "${name.replace(/"/g, '\\"')}")
  repeat with p in matches
    set pname to name of p
    set allHandles to ""
    -- collect all phones
    repeat with ph in phones of p
      set allHandles to allHandles & value of ph & ";"
    end repeat
    -- collect all emails
    repeat with em in emails of p
      set allHandles to allHandles & value of em & ";"
    end repeat
    if allHandles is not "" then
      set out to out & pname & "|" & allHandles & "\\n"
    end if
  end repeat
  return out
end tell`;

  let contactsRaw = '';
  try { contactsRaw = await runAppleScript(lookupScript, 10000); } catch (e) {}

  const contacts = contactsRaw.trim().split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    const cname = (parts[0] || '').trim();
    const handles = (parts[1] || '').split(';').map(h => h.trim()).filter(Boolean);
    return { name: cname, handles };
  }).filter(c => c.handles.length > 0);

  if (contacts.length === 0) throw new Error(`No contact found for "${name}". Ask for their phone number or email.`);
  if (contacts.length === 1) return { resolved: contacts[0].handles[0], allHandles: contacts[0].handles, name: contacts[0].name };

  // Multiple contacts — ask immediately, no hanging
  return {
    ambiguous: true,
    options: contacts,
    question: `Found ${contacts.length} people named "${name}": ${contacts.map((c, i) => `${i + 1}. ${c.name}`).join(', ')}. Which one did you mean?`,
  };
}

/**
 * Normalize a phone number to the format Messages.app expects.
 * Tries to produce E.164 (+1XXXXXXXXXX for US numbers).
 */
function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return raw; // return as-is if we can't normalize
}

async function handleiMessageSend(params) {
  const { to, message } = params;
  if (!to || !message) throw new Error('Missing to or message for iMessage.');

  const contact = await resolveContact(to);
  if (contact.ambiguous) return contact.question;

  // Build a list of handles to try: normalized phones first, then emails
  const allHandles = contact.allHandles || [contact.resolved];
  const phones = allHandles.filter(h => !h.includes('@')).map(normalizePhone);
  const emails = allHandles.filter(h => h.includes('@'));
  const tryOrder = [...phones, ...emails];

  let lastErr = null;
  for (const handle of tryOrder) {
    const sendScript = `
tell application "Messages"
  set targetService to first service whose service type = iMessage
  set targetBuddy to buddy "${handle.replace(/"/g, '\\"')}" of targetService
  send "${message.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" to targetBuddy
end tell
"sent"`;
    try {
      await runAppleScript(sendScript, 20000);
      return `iMessage sent.\nTo: ${contact.name || to} (${handle})\nMessage: ${message}`;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Could not send iMessage to ${contact.name || to}. Tried: ${tryOrder.join(', ')}. Error: ${lastErr?.message}`);
}

/**
 * Read the last N messages from a contact.
 * Uses sqlite3 against ~/Library/Messages/chat.db.
 * Returns a JSON string with the message thread.
 */
async function handleReadMessages(params) {
  const { to, count = 10 } = params;
  if (!to) throw new Error('Missing to for read_messages.');

  // Resolve contact to get their phone/email handle
  const contact = await resolveContact(to);
  if (contact.ambiguous) return contact.question;

  const allHandles = contact.allHandles || [contact.resolved];
  const phones = allHandles.filter(h => !h.includes('@')).map(normalizePhone);
  const emails = allHandles.filter(h => h.includes('@'));
  const handles = [...phones, ...emails];

  if (handles.length === 0) throw new Error(`No handle found for "${to}".`);

  // Build WHERE clause to match any of the contact's handles
  const handleConditions = handles.map(h => {
    const digits = h.replace(/\D/g, '');
    return digits.length >= 7
      ? `(replace(replace(replace(replace(h.id,'+',''),' ',''),'-',''),'(','') LIKE '%${digits.slice(-10)}%')`
      : `h.id = '${h.replace(/'/g, "''")}'`;
  }).join(' OR ');

  const dbPath = `${process.env.HOME}/Library/Messages/chat.db`;
  const sql = `SELECT m.text, m.is_from_me, datetime(m.date/1000000000+978307200,'unixepoch','localtime') as ts FROM message m JOIN chat_message_join cmj ON m.rowid=cmj.message_id JOIN chat_handle_join chj ON cmj.chat_id=chj.chat_id JOIN handle h ON chj.handle_id=h.rowid WHERE (${handleConditions}) AND m.text IS NOT NULL AND m.text != '' ORDER BY m.date DESC LIMIT ${Math.min(count, 20)};`;

  const raw = await runShell(`sqlite3 "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, 12000);
  if (!raw.trim()) return JSON.stringify({ contact: contact.name || to, messages: [], note: 'No messages found.' });

  const msgs = raw.trim().split('\n').reverse().map(line => {
    const parts = line.split('|');
    return {
      from: parts[1] === '1' ? 'me' : (contact.name || to),
      text: parts[0] || '',
      time: parts[2] || '',
    };
  });

  return JSON.stringify({ contact: contact.name || to, handle: handles[0], messages: msgs });
}

async function handleRun(params) {
  const { script, shell } = params;
  if (script) {
    const result = await runAppleScript(script, 60000);
    return result || 'Done.';
  }
  if (shell) {
    const result = await runShell(shell, 30000);
    return result || 'Done.';
  }
  throw new Error('No script or shell command provided.');
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function dispatch(msg) {
  const { type } = msg;
  switch (type) {
    case 'calendar_add':    return await handleCalendarAdd(msg);
    case 'calendar_delete': return await handleCalendarDelete(msg);
    case 'email_send':      return await handleEmailSend(msg);
    case 'imessage_send':   return await handleiMessageSend(msg);
    case 'read_messages':   return await handleReadMessages(msg);
    case 'run':             return await handleRun(msg);
    case 'ping':            return 'pong';
    default:
      throw new Error('Unknown command type: ' + type);
  }
}

// ── WebSocket connection to relay ──────────────────────────���───────────���───

let ws = null;
let reconnectDelay = 2000;

function connect() {
  console.log(`[openmud-agent] Connecting to ${RELAY_URL}...`);
  ws = new WebSocket(RELAY_URL);

  ws.on('open', () => {
    reconnectDelay = 2000;
    ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'auth_ok') {
      console.log(`[openmud-agent] Connected to openmud relay. Ready.`);
      console.log(`[openmud-agent] Platform: ${os.platform()} ${os.arch()}`);
      return;
    }

    // Incoming command from openmud chat
    if (msg.requestId) {
      const label = (msg.type || 'chat') + ':' + msg.requestId.slice(0, 8);
      console.log(`[openmud-agent] Command received: ${label}`);
      try {
        const response = await dispatch(msg);
        console.log(`[openmud-agent] Done: ${label}`);
        ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, response }));
      } catch (err) {
        console.error(`[openmud-agent] Error: ${err.message}`);
        ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, error: err.message }));
      }
    }
  });

  ws.on('close', () => {
    console.log(`[openmud-agent] Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on('error', err => {
    console.error(`[openmud-agent] Error: ${err.message}`);
  });
}

connect();
