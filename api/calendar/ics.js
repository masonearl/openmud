function escIcs(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toStamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toDateOnly(date) {
  return new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
}

function uidFromEvent(eventData) {
  const seed = `${eventData.title || 'event'}-${eventData.start_iso || ''}-${eventData.end_iso || ''}`;
  const safe = Buffer.from(seed).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `${safe}@openmud.ai`;
}

function buildIcs(eventData) {
  const allDay = Boolean(eventData.all_day);
  const start = eventData.start_iso;
  const end = eventData.end_iso || eventData.start_iso;
  const now = new Date().toISOString();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//openmud//Calendar Event//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uidFromEvent(eventData)}`,
    `DTSTAMP:${toStamp(now)}`,
  ];

  if (allDay) {
    const startDate = toDateOnly(start);
    const endDate = toDateOnly(new Date(new Date(end).getTime() + (24 * 60 * 60 * 1000)));
    lines.push(`DTSTART;VALUE=DATE:${startDate}`);
    lines.push(`DTEND;VALUE=DATE:${endDate}`);
  } else {
    lines.push(`DTSTART:${toStamp(start)}`);
    lines.push(`DTEND:${toStamp(end)}`);
  }

  lines.push(`SUMMARY:${escIcs(eventData.title || 'Event')}`);
  if (eventData.location) lines.push(`LOCATION:${escIcs(eventData.location)}`);
  if (eventData.description) lines.push(`DESCRIPTION:${escIcs(eventData.description)}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return `${lines.join('\r\n')}\r\n`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const encoded = String(req.query?.data || '');
    if (!encoded) {
      return res.status(400).json({ error: 'Missing calendar payload' });
    }
    const decoded = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf8');
    const eventData = JSON.parse(decoded);

    if (!eventData.title || !eventData.start_iso) {
      return res.status(400).json({ error: 'Invalid calendar payload' });
    }

    const ics = buildIcs(eventData);
    const filename = `${String(eventData.title || 'event').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'event'}.ics`;
    const forceDownload = String(req.query?.download || '') === '1';
    const dispositionType = forceDownload ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
    return res.status(200).send(ics);
  } catch (err) {
    return res.status(400).json({ error: 'Could not generate calendar file' });
  }
};
