const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_FILE_BYTES_DEFAULT = 20 * 1024 * 1024; // 20 MB
const MAX_FILES_DEFAULT = 12;

function escapeAppleScriptString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function buildMailCondition(sender, subject) {
  const senderEsc = escapeAppleScriptString(sender || '');
  const subjectEsc = escapeAppleScriptString(subject || '');
  if (senderEsc && subjectEsc) {
    return `(sender of it contains "${senderEsc}") and (subject of it contains "${subjectEsc}")`;
  }
  if (senderEsc) return `sender of it contains "${senderEsc}"`;
  if (subjectEsc) return `subject of it contains "${subjectEsc}"`;
  return null;
}

function inferMimeType(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.dwg': 'application/acad',
  };
  return map[ext] || 'application/octet-stream';
}

function safeCleanup(targetPath) {
  if (!targetPath) return;
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (_) {
    // Ignore cleanup errors.
  }
}

function extractMailAttachments(opts = {}) {
  const sender = String(opts.sender || '').trim();
  const subject = String(opts.subject || '').trim();
  const index = Math.max(0, parseInt(opts.index, 10) || 0);
  const messageId = opts.message_id != null ? parseInt(opts.message_id, 10) : null;
  const maxFileBytes = Math.max(256 * 1024, parseInt(opts.max_file_bytes, 10) || MAX_FILE_BYTES_DEFAULT);
  const maxFiles = Math.max(1, parseInt(opts.max_files, 10) || MAX_FILES_DEFAULT);

  const condition = buildMailCondition(sender, subject);
  if (!condition) {
    return { ok: false, error: 'Need sender or subject to locate email', attachments: [] };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudrag-mail-attachments-'));
  const scriptPath = path.join(
    os.tmpdir(),
    `mudrag-mail-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.scpt`
  );

  try {
    const outDirEsc = escapeAppleScriptString(tmpDir);
    const useMessageId = messageId != null && !isNaN(messageId);
    const script = `set outDir to "${outDirEsc}"
set targetIndex to ${index}
set targetMessageId to ${useMessageId ? messageId : -1}
set useMessageId to ${useMessageId ? 'true' : 'false'}
set matchCounter to 0

tell application "Mail"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msgs to (every message of mb whose ${condition})
        repeat with msg in msgs
          set isMatch to false
          if useMessageId then
            try
              if (id of msg) is targetMessageId then set isMatch to true
            end try
          else
            if matchCounter = targetIndex then set isMatch to true
          end if
          if isMatch then
            set savedPaths to {}
            repeat with att in (mail attachments of msg)
              try
                set rawName to name of att
              on error
                set rawName to "attachment-" & ((count of savedPaths) + 1) & ".bin"
              end try
              set cleanName to my sanitizeName(rawName)
              set destPath to my uniquePath(outDir, cleanName)
              try
                save att in POSIX file destPath
                copy destPath to end of savedPaths
              end try
            end repeat
            if (count of savedPaths) is 0 then
              return "__MUDRAG_NO_ATTACHMENTS__"
            end if
            set AppleScript's text item delimiters to linefeed
            set outputText to savedPaths as text
            set AppleScript's text item delimiters to ""
            return outputText
          end if
          set matchCounter to matchCounter + 1
        end repeat
      end try
    end repeat
  end repeat
end tell

return "__MUDRAG_NOT_FOUND__"

on sanitizeName(rawName)
  set cleaned to rawName
  set cleaned to my replaceText(":", "-", cleaned)
  set cleaned to my replaceText("/", "-", cleaned)
  if cleaned is "" then set cleaned to "attachment.bin"
  return cleaned
end sanitizeName

on uniquePath(outDir, fileName)
  set p to outDir & "/" & fileName
  set n to 1
  repeat while (do shell script "test -e " & quoted form of p & "; echo $?") is "0"
    set p to outDir & "/" & n & "-" & fileName
    set n to n + 1
  end repeat
  return p
end uniquePath

on replaceText(findText, replText, inputText)
  set AppleScript's text item delimiters to findText
  set parts to text items of inputText
  set AppleScript's text item delimiters to replText
  set outText to parts as text
  set AppleScript's text item delimiters to ""
  return outText
end replaceText
`;
    fs.writeFileSync(scriptPath, script, 'utf8');

    const rawOut = execFileSync('osascript', [scriptPath], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const out = String(rawOut || '').trim();

    if (out === '__MUDRAG_NOT_FOUND__') {
      return { ok: false, error: 'Could not find that email in Mail.app', attachments: [] };
    }
    if (out === '__MUDRAG_NO_ATTACHMENTS__') {
      return { ok: true, attachments: [], count: 0, skipped: [] };
    }

    const paths = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const attachments = [];
    const skipped = [];

    for (const p of paths) {
      if (attachments.length >= maxFiles) {
        skipped.push({ path: p, reason: 'max_files_exceeded' });
        continue;
      }
      if (!fs.existsSync(p)) {
        skipped.push({ path: p, reason: 'missing_after_export' });
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(p);
      } catch (_) {
        skipped.push({ path: p, reason: 'stat_failed' });
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > maxFileBytes) {
        skipped.push({ path: p, reason: 'file_too_large', size: stat.size });
        continue;
      }
      try {
        const buf = fs.readFileSync(p);
        const name = path.basename(p) || `attachment-${attachments.length + 1}`;
        attachments.push({
          name,
          size: buf.length,
          mime: inferMimeType(name),
          base64: buf.toString('base64'),
        });
      } catch (_) {
        skipped.push({ path: p, reason: 'read_failed' });
      }
    }

    return {
      ok: true,
      attachments,
      count: attachments.length,
      skipped,
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : 'Attachment extraction failed',
      attachments: [],
    };
  } finally {
    safeCleanup(scriptPath);
    safeCleanup(tmpDir);
  }
}

module.exports = {
  extractMailAttachments,
  inferMimeType,
};
