/**
 * Data sync module for openmud desktop app.
 * Pulls contacts from macOS Contacts app and recent emails via mail-search.
 * All data stays local in userData/storage/user-data.json.
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAIL_SCRIPT = path.join(os.homedir(), '.codex', 'skills', 'mail-search', 'scripts', 'search_mail.py');

/**
 * Pull contacts from macOS Contacts.app via osascript.
 * Returns array of { name, email, phone, company }.
 */
function syncContacts() {
  return new Promise((resolve) => {
    const script = `
tell application "Contacts"
  set output to ""
  repeat with p in every person
    set pName to ""
    set pEmail to ""
    set pPhone to ""
    set pCompany to ""
    try
      set pName to name of p
    end try
    try
      if (count of emails of p) > 0 then
        set pEmail to value of first email of p
      end if
    end try
    try
      if (count of phones of p) > 0 then
        set pPhone to value of first phone of p
      end if
    end try
    try
      set pCompany to organization of p
    end try
    if pName is not "" then
      set output to output & pName & "|||" & pEmail & "|||" & pPhone & "|||" & pCompany & "\\n"
    end if
  end repeat
  return output
end tell
`;
    const tmpPath = path.join(os.tmpdir(), 'mudrag_contacts_sync.scpt');
    try {
      fs.writeFileSync(tmpPath, script, 'utf8');
      const raw = execSync(`osascript "${tmpPath}"`, { timeout: 30000, encoding: 'utf8' });
      const contacts = raw.trim().split('\n').filter(Boolean).map((line) => {
        const [name, email, phone, company] = line.split('|||');
        return {
          name: (name || '').trim(),
          email: (email || '').trim(),
          phone: (phone || '').trim(),
          company: (company || '').trim(),
        };
      }).filter((c) => c.name);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      resolve({ ok: true, contacts, count: contacts.length });
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      resolve({ ok: false, error: e.message, contacts: [] });
    }
  });
}

/**
 * Pull recent emails via mail-search Python script.
 * Returns array of { sender, subject, date, snippet }.
 */
function syncEmails(options) {
  const since = (options && options.since) || '30 days';
  const limit = (options && options.limit) || 150;

  return new Promise((resolve) => {
    if (!fs.existsSync(MAIL_SCRIPT)) {
      resolve({ ok: false, error: 'Mail search script not found. Install the mail-search skill.', emails: [] });
      return;
    }

    const args = [
      MAIL_SCRIPT,
      '--format', 'json',
      '--since', since,
      '--limit', String(limit),
    ];

    const py = spawn('python3', args);
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d.toString(); });
    py.stderr.on('data', (d) => { err += d.toString(); });
    py.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: err || 'Mail search failed', emails: [] });
        return;
      }
      try {
        const parsed = JSON.parse(out || '[]');
        const emails = (Array.isArray(parsed) ? parsed : (parsed.results || [])).map((m) => ({
          sender: m.sender || m.from || '',
          subject: m.subject || '',
          date: m.date || m.received || '',
          snippet: (m.body || m.snippet || '').slice(0, 300),
        }));
        resolve({ ok: true, emails, count: emails.length });
      } catch (e) {
        resolve({ ok: false, error: 'Could not parse mail results: ' + e.message, emails: [] });
      }
    });
  });
}

module.exports = { syncContacts, syncEmails };
