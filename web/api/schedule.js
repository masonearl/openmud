/**
 * Schedule generation API - returns a professional schedule document layout
 * with summary metadata, milestone table, execution notes, and assumptions.
 */
function buildSchedule(projectName, durationDays, startDate, phases, options) {
  const opts = options || {};
  const start = startDate ? new Date(startDate) : new Date();
  const duration = Math.max(1, parseInt(durationDays, 10) || 14);
  const phaseList = Array.isArray(phases) && phases.length > 0
    ? phases
    : ['Mobilization', 'Trenching', 'Pipe install', 'Backfill', 'Restoration'];
  const daysPerPhase = Math.max(1, Math.floor(duration / phaseList.length));
  const rows = [];
  let d = new Date(start);

  for (let i = 0; i < phaseList.length; i++) {
    const phaseDays = i === phaseList.length - 1
      ? duration - (phaseList.length - 1) * daysPerPhase
      : daysPerPhase;
    const end = new Date(d);
    end.setDate(end.getDate() + phaseDays - 1);
    rows.push({
      phase: phaseList[i],
      start: d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
      end: end.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
      days: phaseDays,
    });
    d.setDate(d.getDate() + phaseDays);
  }

  const finishDate = rows.length > 0 ? rows[rows.length - 1].end : start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const dateIssued = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const assumptions = String(opts.assumptions || '').trim()
    || 'This preliminary schedule assumes normal access, standard working hours, timely submittal review, utility locates complete before trenching, and no owner-driven scope changes after mobilization.';
  const notes = String(opts.execution_notes || '').trim()
    || 'Use this schedule as a planning baseline. Update dates, crew sequencing, inspections, shutdowns, and restoration milestones to match field conditions and contract requirements.';

  const companyName = String(opts.company_name || '').trim();
  const companyContact = String(opts.company_contact || '').trim();
  const companyPhone = String(opts.company_phone || '').trim();
  const companyEmail = String(opts.company_email || '').trim();
  const companyLogo = String(opts.company_logo || '').trim();

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let table = '<table style="width:100%;border-collapse:collapse;"><tr style="background:#d9d9d9;"><th style="padding:8px 10px;text-align:left;color:#111;border:1px solid #000;">Phase</th><th style="padding:8px 10px;text-align:left;color:#111;border:1px solid #000;">Start</th><th style="padding:8px 10px;text-align:left;color:#111;border:1px solid #000;">Finish</th><th style="padding:8px 10px;text-align:right;color:#111;border:1px solid #000;">Days</th></tr>';
  rows.forEach((r) => {
    table += `<tr><td style="padding:8px 10px;border:1px solid #000;color:#111;">${escHtml(r.phase)}</td><td style="padding:8px 10px;border:1px solid #000;color:#111;">${escHtml(r.start)}</td><td style="padding:8px 10px;border:1px solid #000;color:#111;">${escHtml(r.end)}</td><td style="padding:8px 10px;border:1px solid #000;color:#111;text-align:right;">${r.days}</td></tr>`;
  });
  table += '</table>';

  const logoHtml = companyLogo
    ? `<img src="${companyLogo}" style="display:block;max-height:44px;max-width:160px;object-fit:contain;margin-bottom:10px;" alt="${escHtml(companyName || 'Logo')}">`
    : '';
  const issuerLine = [companyContact, companyName].filter(Boolean).join(' · ');
  const footerLine = [companyPhone, companyEmail].filter(Boolean).join(' · ') || 'openmud.ai';

  const html = `<div class="pdf-doc pdf-doc-schedule" style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 36px;max-width:720px;margin:0 auto;background:#ffffff;color:#111111;font-size:11px;line-height:1.5;box-sizing:border-box;">
<div style="background:#f5f5f5;border:1px solid #c8c8c8;border-radius:4px;padding:12px 18px 14px;margin-bottom:20px;">
  ${logoHtml}
  ${issuerLine ? `<div style="font-size:9px;color:#666;margin:0 0 6px;">${escHtml(issuerLine)}</div>` : ''}
  <div style="font-size:20px;font-weight:700;color:#111;margin:0 0 2px;">Preliminary Schedule</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-top:6px;">
    <div>
      <div style="font-size:8px;color:#666;">Project</div>
      <div style="font-size:9px;color:#111;font-weight:500;">${escHtml(projectName)}</div>
    </div>
    <div>
      <div style="font-size:8px;color:#666;">Issued</div>
      <div style="font-size:9px;color:#111;">${dateIssued}</div>
    </div>
  </div>
</div>
<div style="background:#404040;color:#fff;padding:5px 10px;height:22px;line-height:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-radius:3px;margin:20px 0 12px;box-sizing:border-box;">Schedule Summary</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px;margin-bottom:14px;">
  <div><div style="font-size:8px;color:#666;">Start Date</div><div style="font-size:10px;color:#111;font-weight:600;">${escHtml(rows[0] ? rows[0].start : finishDate)}</div></div>
  <div><div style="font-size:8px;color:#666;">Finish Date</div><div style="font-size:10px;color:#111;font-weight:600;">${escHtml(finishDate)}</div></div>
  <div><div style="font-size:8px;color:#666;">Duration</div><div style="font-size:10px;color:#111;font-weight:600;">${duration} days</div></div>
  <div><div style="font-size:8px;color:#666;">Phases</div><div style="font-size:10px;color:#111;font-weight:600;">${rows.length}</div></div>
</div>
<div style="background:#404040;color:#fff;padding:5px 10px;height:22px;line-height:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-radius:3px;margin:20px 0 12px;box-sizing:border-box;">Milestones and Phasing</div>
${table}
<div style="background:#404040;color:#fff;padding:5px 10px;height:22px;line-height:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-radius:3px;margin:20px 0 12px;box-sizing:border-box;">Assumptions</div>
<div style="font-size:10px;line-height:1.65;color:#111;">${escHtml(assumptions).replace(/\n/g, '<br>')}</div>
<div style="background:#404040;color:#fff;padding:5px 10px;height:22px;line-height:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-radius:3px;margin:20px 0 12px;box-sizing:border-box;">Execution Notes</div>
<div style="font-size:10px;line-height:1.65;color:#111;">${escHtml(notes).replace(/\n/g, '<br>')}</div>
<div style="margin-top:24px;padding-top:8px;border-top:1px solid #c8c8c8;text-align:center;">
  <div style="display:inline-block;padding:8px 18px;background:#f9f9f9;border:1px solid #dcdcdc;border-radius:4px;margin-bottom:6px;">
    <div style="font-size:9px;font-weight:600;color:#111;">${escHtml(companyName || 'Generated by openmud')}</div>
    <div style="font-size:9px;color:#666;">${escHtml(footerLine)}</div>
  </div>
</div></div>`;

  return { project_name: projectName, duration, phases: rows, table_html: table, finish_date: finishDate, html };
}

async function scheduleHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      project_name, duration_days, start_date, phases,
      company_name, company_contact, company_phone, company_email, company_logo,
      assumptions, execution_notes,
    } = req.body || {};
    const result = buildSchedule(
      project_name || 'Project',
      duration_days || 14,
      start_date || null,
      phases || null,
      {
        company_name: company_name || '',
        company_contact: company_contact || '',
        company_phone: company_phone || '',
        company_email: company_email || '',
        company_logo: company_logo || '',
        assumptions: assumptions || '',
        execution_notes: execution_notes || '',
      }
    );
    return res.status(200).json(result);
  } catch (err) {
    console.error('Schedule error:', err);
    return res.status(500).json({ error: err.message || 'Schedule generation failed' });
  }
}

scheduleHandler.buildSchedule = buildSchedule;
module.exports = scheduleHandler;
