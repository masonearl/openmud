function buildChangeOrder(params) {
  const {
    project_name = 'Project',
    client = 'Project',
    co_number = '',
    title = 'Change Order',
    change_reason = '',
    scope = '',
    line_items = [],
    amount = 0,
    duration_days = null,
    schedule_impact = '',
    assumptions = '',
    exclusions = '',
    company_name = '',
    company_contact = '',
    company_phone = '',
    company_email = '',
    company_logo = '',
    theme = 'light',
  } = params || {};

  const isDark = theme === 'dark';
  const bg = isDark ? '#1a1a1a' : '#ffffff';
  const text = isDark ? '#e5e5e5' : '#111111';
  const textSub = isDark ? '#a0a0a0' : '#646464';
  const hdrBg = isDark ? '#242424' : '#f5f5f5';
  const hdrBdr = isDark ? '#383838' : '#c8c8c8';
  const barBg = isDark ? '#2d2d2d' : '#404040';
  const barText = isDark ? '#e5e5e5' : '#ffffff';
  const tblHeaderBg = isDark ? '#2a2a2a' : '#c8c8c8';
  const tblRowAlt = isDark ? '#212121' : '#f5f5f5';
  const tblBdr = isDark ? '#3a3a3a' : '#000000';
  const ftBg = isDark ? '#222222' : '#f9f9f9';
  const ftBdr = isDark ? '#383838' : '#dcdcdc';

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sectionBar(titleText) {
    return `<div style="background:${barBg};color:${barText};padding:5px 10px;height:22px;line-height:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-radius:3px;margin:20px 0 12px;box-sizing:border-box;">${escHtml(titleText)}</div>`;
  }

  function textSection(titleText, body) {
    const content = String(body || '').trim();
    if (!content) return '';
    return `${sectionBar(titleText)}
<div style="font-size:10px;line-height:1.65;color:${text};">${escHtml(content).replace(/\n/g, '<br>')}</div>`;
  }

  function itemsTable(items) {
    const rows = (items || []).map((item, idx) => {
      const rowBg = idx % 2 === 1 ? tblRowAlt : bg;
      const qtyRaw = item && item.qty != null ? item.qty : item && item.quantity != null ? item.quantity : null;
      const qty = qtyRaw != null ? qtyRaw : '—';
      const unit = item && item.unit ? item.unit : '—';
      const unitPrice = item && item.unit_price != null ? `$${Number(item.unit_price).toLocaleString()}` : '—';
      const rowAmount = item && item.amount != null ? `$${Math.round(item.amount).toLocaleString()}` : '—';
      return `<tr style="background:${rowBg};">
        <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${textSub};font-size:9px;text-align:center;width:24px;">${idx + 1}</td>
        <td style="padding:5px 8px;border:1px solid ${tblBdr};color:${text};font-size:9px;">${escHtml(item && item.description ? item.description : 'Change item')}</td>
        <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:center;">${qty}</td>
        <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:center;">${escHtml(unit)}</td>
        <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:right;">${unitPrice}</td>
        <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:right;font-weight:600;">${rowAmount}</td>
      </tr>`;
    }).join('');
    return `<table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:${tblHeaderBg};">
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:24px;">#</th>
          <th style="padding:6px 8px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:left;">Description</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:42px;">Qty</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:42px;">Unit</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:right;width:80px;">Unit Price</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:right;width:80px;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:${isDark ? '#333333' : '#e6e6e6'};">
          <td colspan="5" style="padding:6px 8px;border:1px solid ${tblBdr};font-weight:700;color:${text};font-size:10px;">Change Order Amount</td>
          <td style="padding:6px 6px;border:1px solid ${tblBdr};text-align:right;font-weight:700;color:${text};font-size:10px;">${amount ? `$${Math.round(amount).toLocaleString()}` : '—'}</td>
        </tr>
      </tfoot>
    </table>`;
  }

  const issueDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const logoHtml = company_logo
    ? `<img src="${company_logo}" style="display:block;max-height:48px;max-width:160px;object-fit:contain;margin-bottom:10px;" alt="${escHtml(company_name || 'Logo')}">`
    : '';
  const headerHtml = `<div style="background:${hdrBg};border:1px solid ${hdrBdr};border-radius:4px;padding:12px 18px 14px;margin-bottom:20px;box-sizing:border-box;">
    ${logoHtml}
    ${company_name || company_contact ? `<div style="font-size:9px;color:${textSub};margin:0 0 6px;">${escHtml([company_name, company_contact].filter(Boolean).join(' · '))}</div>` : ''}
    <div style="font-size:20px;font-weight:700;color:${text};margin:0 0 2px;line-height:1.2;">Change Order</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-top:6px;">
      <div>
        <div style="font-size:8px;color:${textSub};">Project</div>
        <div style="font-size:9px;color:${text};font-weight:500;">${escHtml(project_name)}</div>
      </div>
      <div>
        <div style="font-size:8px;color:${textSub};">Issued</div>
        <div style="font-size:9px;color:${text};">${issueDate}${co_number ? ` · CO ${escHtml(co_number)}` : ''}</div>
      </div>
      <div>
        <div style="font-size:8px;color:${textSub};">Submitted To</div>
        <div style="font-size:9px;color:${text};font-weight:500;">${escHtml(client)}</div>
      </div>
      <div>
        <div style="font-size:8px;color:${textSub};">Title</div>
        <div style="font-size:9px;color:${text};font-weight:500;">${escHtml(title)}</div>
      </div>
    </div>
  </div>`;

  const summaryHtml = `${sectionBar('Change Summary')}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px 14px;">
  <div><div style="font-size:8px;color:${textSub};">Change Order Amount</div><div style="font-size:16px;font-weight:700;color:${text};">${amount ? `$${Math.round(amount).toLocaleString()}` : '—'}</div></div>
  <div><div style="font-size:8px;color:${textSub};">Schedule Impact</div><div style="font-size:10px;font-weight:600;color:${text};">${duration_days ? `${duration_days} day${duration_days !== 1 ? 's' : ''}` : 'No days identified'}</div></div>
  <div><div style="font-size:8px;color:${textSub};">CO Number</div><div style="font-size:10px;font-weight:600;color:${text};">${escHtml(co_number || 'Pending')}</div></div>
</div>`;

  const reasonHtml = textSection('Reason for Change', change_reason);
  const scopeHtml = textSection('Scope of Changed Work', scope);
  const pricingHtml = line_items && line_items.length
    ? `${sectionBar('Pricing Breakdown')}${itemsTable(line_items)}`
    : `${sectionBar('Pricing Breakdown')}<div style="font-size:10px;line-height:1.65;color:${text};">${amount ? `Change order amount requested: $${Math.round(amount).toLocaleString()}.` : 'Pricing to be finalized from supporting records.'}</div>`;
  const scheduleImpactHtml = textSection('Schedule Impact', schedule_impact || (duration_days ? `This change is expected to add ${duration_days} day${duration_days !== 1 ? 's' : ''} to the project duration.` : 'No confirmed schedule impact has been identified yet.'));
  const assumptionsHtml = textSection('Assumptions', assumptions);
  const exclusionsHtml = textSection('Exclusions', exclusions);
  const closingHtml = `${sectionBar('Authorization')}
<div style="font-size:10px;line-height:1.65;color:${text};">This change order is submitted for review and approval so the added or revised work can proceed under documented commercial terms.</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px;">
  <div>
    <div style="font-size:8px;color:${textSub};margin-bottom:18px;">Accepted by</div>
    <div style="border-top:1px solid ${hdrBdr};height:22px;"></div>
    <div style="font-size:8px;color:${textSub};">Authorized signature</div>
  </div>
  <div>
    <div style="font-size:8px;color:${textSub};margin-bottom:18px;">Date</div>
    <div style="border-top:1px solid ${hdrBdr};height:22px;"></div>
    <div style="font-size:8px;color:${textSub};">Execution date</div>
  </div>
</div>`;

  const footerHtml = `<div style="margin-top:24px;padding-top:8px;border-top:1px solid ${hdrBdr};text-align:center;">
    <div style="display:inline-block;padding:8px 18px;background:${ftBg};border:1px solid ${ftBdr};border-radius:4px;margin-bottom:6px;">
      <div style="font-size:9px;font-weight:600;color:${text};">${escHtml(company_name || 'Generated by openmud')}</div>
      <div style="font-size:9px;color:${textSub};">${escHtml([company_phone, company_email].filter(Boolean).join(' · ') || 'openmud.ai')}</div>
    </div>
  </div>`;

  const html = `<div class="pdf-doc pdf-doc-change-order" style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 36px;max-width:700px;margin:0 auto;background:${bg};color:${text};font-size:11px;line-height:1.5;box-sizing:border-box;">
${headerHtml}
${summaryHtml}
${reasonHtml}
${scopeHtml}
${pricingHtml}
${scheduleImpactHtml}
${assumptionsHtml}
${exclusionsHtml}
${closingHtml}
${footerHtml}
</div>`;

  return {
    project_name,
    client,
    co_number,
    title,
    change_reason,
    scope,
    line_items,
    amount,
    duration_days,
    schedule_impact,
    html,
    theme,
  };
}

async function changeOrderHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const result = buildChangeOrder({
      project_name: body.project_name || 'Project',
      client: body.client || body.client_name || 'Project',
      co_number: body.co_number || '',
      title: body.title || 'Change Order',
      change_reason: body.change_reason || body.reason || '',
      scope: body.scope || '',
      line_items: body.line_items || body.bid_items || [],
      amount: parseFloat(body.amount) || 0,
      duration_days: body.duration_days != null ? parseInt(body.duration_days, 10) : null,
      schedule_impact: body.schedule_impact || '',
      assumptions: body.assumptions || '',
      exclusions: body.exclusions || '',
      company_name: body.company_name || '',
      company_contact: body.company_contact || '',
      company_phone: body.company_phone || '',
      company_email: body.company_email || '',
      company_logo: body.company_logo || '',
      theme: body.theme === 'dark' ? 'dark' : 'light',
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('Change order error:', err);
    return res.status(500).json({ error: err.message || 'Change order generation failed' });
  }
}

changeOrderHandler.buildChangeOrder = buildChangeOrder;
module.exports = changeOrderHandler;
