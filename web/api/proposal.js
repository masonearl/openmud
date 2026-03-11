/**
 * Proposal generation — full document layout modeled after the Construction Proposal Generator
 * (masonearl.com/proposal-generator & Xcode SwiftPDFGenerator design language).
 *
 * Structure:
 *   Header box → Scope of Work → Bid Items → Inclusions → Exclusions → [Assumptions] → Closing → Footer
 */

function buildProposal(params) {
  const {
    client       = 'Project',
    scope        = '',
    total        = 0,
    duration     = null,
    executive_summary = '',
    technical_approach = '',
    assumptions  = '',
    exclusions   = '',
    inclusions   = '',
    closing_note = '',
    bid_items    = [],
    logistics_plan = '',
    major_milestones = [],
    project_risks = [],
    // Optional company fields — forwarded from app settings if available
    company_name    = '',
    company_contact = '',
    company_phone   = '',
    company_email   = '',
    company_url     = '',
    company_logo    = '',   // base64 data URL or https URL
    payment_terms   = '',
    change_order_terms = '',
    warranty        = '',
    validity_days   = 30,
    theme        = 'light',
  } = params;

  const isDark = theme === 'dark';

  // ── Palette (mirrors masonearl.com + SwiftPDFGenerator) ────────────────────
  const bg           = isDark ? '#1a1a1a' : '#ffffff';
  const text         = isDark ? '#e5e5e5' : '#111111';
  const textSub      = isDark ? '#a0a0a0' : '#646464';
  const textMeta     = isDark ? '#787878' : '#787878';

  // Header box
  const hdrBg        = isDark ? '#242424' : '#f5f5f5';
  const hdrBdr       = isDark ? '#383838' : '#c8c8c8';

  // Section title bars — exactly #404040 light, slightly lighter dark
  const barBg        = isDark ? '#2d2d2d' : '#404040';
  const barText      = isDark ? '#e5e5e5' : '#ffffff';
  const barBdr       = isDark ? '#404040' : '#404040';

  // Tables
  const tblHeaderBg  = isDark ? '#2a2a2a' : '#c8c8c8';
  const tblRowAlt    = isDark ? '#212121' : '#f5f5f5';
  const tblBdr       = isDark ? '#3a3a3a' : '#000000';
  const tblTotalBg   = isDark ? '#333333' : '#e6e6e6';

  // Footer box
  const ftBg         = isDark ? '#222222' : '#f9f9f9';
  const ftBdr        = isDark ? '#383838' : '#dcdcdc';

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const totalStr = total ? `$${Math.round(total).toLocaleString()}` : '—';
  const dateStr  = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  /** Dark section bar — matches masonearl.com preview-chunk-title exactly */
  function sectionBar(title) {
    return `<div style="background:${barBg};color:${barText};padding:5px 10px;height:22px;line-height:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-radius:3px;margin:20px 0 12px;box-sizing:border-box;">${title}</div>`;
  }

  /** Numbered single-column table for inclusions / exclusions */
  function itemsTable(items) {
    const rows = items.map((item, idx) => {
      const rowBg = idx % 2 === 1 ? tblRowAlt : bg;
      return `<tr style="background:${rowBg};">
        <td style="padding:5px 8px;border:1px solid ${tblBdr};color:${textSub};font-size:9px;width:24px;text-align:center;">${idx + 1}</td>
        <td style="padding:5px 10px;border:1px solid ${tblBdr};color:${text};font-size:9px;">${escHtml(item)}</td>
      </tr>`;
    }).join('');
    return `<table style="width:100%;border-collapse:collapse;font-size:9px;">
      <thead>
        <tr style="background:${tblHeaderBg};">
          <th style="padding:5px 8px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:24px;">#</th>
          <th style="padding:5px 10px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:left;">Item</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function textSection(title, body) {
    const content = String(body || '').trim();
    if (!content) return '';
    return `${sectionBar(title)}
<div style="font-size:10px;line-height:1.65;color:${text};">${escHtml(content).replace(/\n/g, '<br>')}</div>`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── HEADER ──────────────────────────────────────────────────────────────────
  // Mirrors masonearl.com preview-header: gray box, title left, meta below
  const hasCompany = company_name || company_contact;
  const companyLine = hasCompany
    ? `<div style="font-size:9px;color:${textSub};margin:0 0 6px;">${escHtml([company_name, company_contact].filter(Boolean).join(' · '))}</div>`
    : '';

  // Submitted To / Submitted By grid (like SimpleProposal Xcode app)
  const metaGrid = `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-top:6px;">
  <div>
    <div style="font-size:8px;color:${textSub};">Submitted To</div>
    <div style="font-size:9px;color:${text};font-weight:500;">${escHtml(client)}</div>
  </div>
  <div>
    <div style="font-size:8px;color:${textSub};">Date</div>
    <div style="font-size:9px;color:${text};">${dateStr}${duration ? ` · ${duration} day${duration !== 1 ? 's' : ''}` : ''}</div>
  </div>
</div>`;

  const logoHtml = company_logo
    ? `<img src="${company_logo}" style="display:block;max-height:48px;max-width:160px;object-fit:contain;margin-bottom:10px;" alt="${escHtml(company_name || 'Logo')}">`
    : '';

  const headerHtml = `
<div style="background:${hdrBg};border:1px solid ${hdrBdr};border-radius:4px;padding:12px 18px 14px;margin-bottom:20px;box-sizing:border-box;">
  ${logoHtml}
  ${companyLine}
  <div style="font-size:20px;font-weight:700;color:${text};margin:0 0 2px;line-height:1.2;">Proposal</div>
  ${metaGrid}
</div>`;

  // ── SCOPE OF WORK ────────────────────────────────────────────────────────────
  // Intro sentence mirrors SimpleProposal.swift buildHTML approach
  const introLine = company_name
    ? `<p style="margin:0 0 6px;font-size:10px;color:${text};">${escHtml(company_name)} proposes the following scope of work and pricing for ${escHtml(client)}.</p>`
    : `<p style="margin:0 0 6px;font-size:10px;color:${text};">We propose the following scope of work and pricing for ${escHtml(client)}.</p>`;

  const executiveSummaryHtml = textSection('Executive Summary', executive_summary);

  const scopeHtml = `${sectionBar('Scope of Work')}
${introLine}
<div style="font-size:10px;line-height:1.65;color:${text};">${escHtml(scope || '—').replace(/\n/g, '<br>')}</div>`;
  const technicalApproachHtml = textSection('Technical Approach / Means and Methods', technical_approach);

  // ── BID ITEMS ────────────────────────────────────────────────────────────────
  let bidItemsHtml = '';
  if (Array.isArray(bid_items) && bid_items.length > 0) {
    const valid = bid_items.filter(i => i && (i.description || i.amount != null));

    // Detect extended columns (qty / unit / unit_price)
    const hasExtended = valid.some(i => i.qty != null || i.quantity != null || i.unit || i.unit_price != null);

    const rows = valid.map((item, idx) => {
      const desc   = escHtml((item.description || '').trim() || '—');
      const amt    = item.amount != null ? `$${Math.round(item.amount).toLocaleString()}` : '—';
      const rowBg  = idx % 2 === 1 ? tblRowAlt : bg;

      if (hasExtended) {
        const qtyRaw = item.qty != null ? item.qty : item.quantity;
        const qty    = qtyRaw != null ? qtyRaw : '—';
        const unit   = item.unit              ? item.unit   : '—';
        const uPrice = item.unit_price != null ? `$${Number(item.unit_price).toLocaleString()}` : '—';
        return `<tr style="background:${rowBg};">
          <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${textSub};font-size:9px;text-align:center;width:24px;">${idx + 1}</td>
          <td style="padding:5px 8px;border:1px solid ${tblBdr};color:${text};font-size:9px;">${desc}</td>
          <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:center;">${qty}</td>
          <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:center;">${unit}</td>
          <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:right;">${uPrice}</td>
          <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:right;font-weight:600;">${amt}</td>
        </tr>`;
      } else {
        return `<tr style="background:${rowBg};">
          <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${textSub};font-size:9px;text-align:center;width:24px;">${idx + 1}</td>
          <td style="padding:5px 8px;border:1px solid ${tblBdr};color:${text};font-size:9px;" colspan="4">${desc}</td>
          <td style="padding:5px 6px;border:1px solid ${tblBdr};color:${text};font-size:9px;text-align:right;font-weight:600;">${amt}</td>
        </tr>`;
      }
    }).join('');

    const thead = hasExtended
      ? `<tr style="background:${tblHeaderBg};">
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:24px;">#</th>
          <th style="padding:6px 8px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:left;">Description</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:42px;">Qty</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:42px;">Unit</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:right;width:80px;">Unit Price</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:right;width:80px;">Amount</th>
        </tr>`
      : `<tr style="background:${tblHeaderBg};">
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:center;width:24px;">#</th>
          <th style="padding:6px 8px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:left;" colspan="4">Description</th>
          <th style="padding:6px 6px;border:1px solid ${tblBdr};color:${text};font-weight:600;font-size:9px;text-align:right;width:80px;">Amount</th>
        </tr>`;

    // Total row — mirrors masonearl.com preview-table tr.total-row
    const totalRow = `<tr style="background:${tblTotalBg};">
      <td colspan="5" style="padding:6px 8px;border:1px solid ${tblBdr};font-weight:700;color:${text};font-size:10px;">Total</td>
      <td style="padding:6px 6px;border:1px solid ${tblBdr};text-align:right;font-weight:700;color:${text};font-size:10px;">${totalStr}</td>
    </tr>`;

    bidItemsHtml = `${sectionBar('Bid Items')}
<table style="width:100%;border-collapse:collapse;">
  <thead>${thead}</thead>
  <tbody>${rows}</tbody>
  <tfoot>${totalRow}</tfoot>
</table>`;
  } else {
    // No line items — show lump sum total + optional duration
    bidItemsHtml = `${sectionBar('Pricing')}
<div style="font-size:18px;font-weight:700;color:${text};margin:0 0 4px;">${totalStr}</div>
${duration ? `<div style="font-size:10px;color:${textSub};">Estimated Duration: ${duration} days</div>` : ''}`;
  }

  // ── INCLUSIONS ───────────────────────────────────────────────────────────────
  // Default list mirrors masonearl.com template exactly
  const defaultInclusions = [
    'All materials and labor required to complete the described scope',
    'Permits and inspections as required by the authority having jurisdiction',
    'Site cleanup and debris removal upon project completion',
    'Project coordination and scheduling',
    'Safety equipment and compliance with applicable regulations',
    'Manufacturer-standard warranties on installed materials',
  ];
  const inclusionsList = inclusions && inclusions.trim()
    ? inclusions.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
    : defaultInclusions;

  const inclusionsHtml = `${sectionBar('Inclusions')}${itemsTable(inclusionsList)}`;

  // ── EXCLUSIONS ───────────────────────────────────────────────────────────────
  // Default list mirrors masonearl.com template exactly
  const defaultExclusions = [
    'Work not specifically described in this proposal',
    'Engineering, design, or architectural services unless explicitly noted',
    'Unforeseen site conditions, hidden obstructions, or hazardous materials',
    'Patch and paint beyond directly disturbed areas unless noted',
    'Weekend, holiday, or overtime work unless separately agreed upon',
    'Temporary facilities or utility services unless specified',
  ];
  const exclusionsList = exclusions && exclusions.trim()
    ? exclusions.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
    : defaultExclusions;

  const exclusionsHtml = `${sectionBar('Exclusions')}${itemsTable(exclusionsList)}`;

  // ── QUALIFICATIONS & CLARIFICATIONS ─────────────────────────────────────────
  // Standard clause list matches SimpleProposal.swift — shown as an extra table section
  const defaultClarifications = [
    'Work to be performed during normal working hours unless otherwise noted',
    'Access, laydown, and locating of existing utilities by others unless specified',
    'All work performed in accordance with applicable codes and safety standards',
    'Unit price items will be adjusted based on final measured quantities',
  ];
  const clarificationsList = defaultClarifications;
  const clarificationsHtml = `${sectionBar('Qualifications & Clarifications')}${itemsTable(clarificationsList)}`;

  // ── ASSUMPTIONS (optional) ───────────────────────────────────────────────────
  let assumptionsHtml = '';
  if (assumptions && assumptions.trim()) {
    assumptionsHtml = `${sectionBar('Assumptions')}
<div style="font-size:10px;line-height:1.65;color:${text};">${escHtml(assumptions.trim()).replace(/\n/g, '<br>')}</div>`;
  }

  const logisticsHtml = textSection('Project Logistics', logistics_plan);
  const milestoneItemsList = Array.isArray(major_milestones)
    ? major_milestones.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const milestonesHtml = milestoneItemsList.length > 0
    ? `${sectionBar('Major Milestones')}${itemsTable(milestoneItemsList)}`
    : '';
  const riskItemsList = Array.isArray(project_risks)
    ? project_risks.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const risksHtml = riskItemsList.length > 0
    ? `${sectionBar('Project Risks and Constraints')}${itemsTable(riskItemsList)}`
    : '';

  const paymentTermsText = (payment_terms && payment_terms.trim())
    ? payment_terms.trim()
    : 'Progress payments are due based on completed work in place and approved billing quantities. Retainage, tax treatment, and billing documentation will follow the contract or owner requirements.';
  const paymentTermsHtml = `${sectionBar('Payment Terms')}
<div style="font-size:10px;line-height:1.65;color:${text};">${escHtml(paymentTermsText).replace(/\n/g, '<br>')}</div>`;

  const changeOrderText = (change_order_terms && change_order_terms.trim())
    ? change_order_terms.trim()
    : 'Changes to scope, quantities, access conditions, utility conflicts, differing site conditions, or owner-directed revisions will be addressed by written change order before extra work proceeds whenever possible.';
  const changeOrderHtml = `${sectionBar('Change Order Procedure')}
<div style="font-size:10px;line-height:1.65;color:${text};">${escHtml(changeOrderText).replace(/\n/g, '<br>')}</div>`;

  const warrantyText = (warranty && warranty.trim())
    ? warranty.trim()
    : 'Installed work will be completed in a professional manner and aligned with applicable codes, specifications, and standard manufacturer warranty requirements for supplied materials.';
  const warrantyHtml = `${sectionBar('Warranty')}
<div style="font-size:10px;line-height:1.65;color:${text};">${escHtml(warrantyText).replace(/\n/g, '<br>')}</div>`;

  // ── CLOSING ──────────────────────────────────────────────────────────────────
  // Mirrors SimpleProposal.swift footer note
  const contactLine = (company_contact && (company_phone || company_email))
    ? ` For questions or clarifications, please contact ${company_contact}${company_phone ? ` at ${company_phone}` : ''}${company_email ? ` or ${company_email}` : ''}.`
    : '';

  const closingText = (closing_note && closing_note.trim())
    ? closing_note.trim()
    : `This proposal is valid for ${Math.max(1, parseInt(validity_days, 10) || 30)} days from the date of issue. All work will be performed in a professional manner in accordance with applicable codes and standards.${contactLine} We appreciate the opportunity to bid on this project and look forward to working with you.`;

  const closingHtml = `${sectionBar('Closing Note')}
<div style="font-size:10px;line-height:1.7;color:${text};">${escHtml(closingText)}</div>`;

  const acceptanceHtml = `${sectionBar('Acceptance')}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:4px;">
  <div>
    <div style="font-size:8px;color:${textSub};margin-bottom:18px;">Accepted by</div>
    <div style="border-top:1px solid ${hdrBdr};height:22px;"></div>
    <div style="font-size:8px;color:${textMeta};">Authorized signature</div>
  </div>
  <div>
    <div style="font-size:8px;color:${textSub};margin-bottom:18px;">Date</div>
    <div style="border-top:1px solid ${hdrBdr};height:22px;"></div>
    <div style="font-size:8px;color:${textMeta};">Execution date</div>
  </div>
</div>`;

  // ── FOOTER ────────────────────────────────────────────────────────────────────
  // Matches masonearl.com preview-footer-box style exactly
  const footerLine1 = company_name
    ? `${company_contact ? escHtml(company_contact) + ', ' : ''}${escHtml(company_name)}`
    : 'Generated by openmud';
  const footerLine2 = (company_phone || company_email)
    ? [company_phone, company_email].filter(Boolean).map(escHtml).join(' &bull; ')
    : 'openmud.ai';

  const footerHtml = `
<div style="margin-top:24px;padding-top:8px;border-top:1px solid ${hdrBdr};text-align:center;">
  <div style="display:inline-block;padding:8px 18px;background:${ftBg};border:1px solid ${ftBdr};border-radius:4px;margin-bottom:6px;">
    <div style="font-size:9px;font-weight:600;color:${text};">${footerLine1}</div>
    <div style="font-size:9px;color:${textSub};">${footerLine2}</div>
  </div>
</div>`;

  // ── ASSEMBLE ──────────────────────────────────────────────────────────────────
  const html = `<div class="pdf-doc pdf-doc-proposal" style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 36px;max-width:700px;margin:0 auto;background:${bg};color:${text};font-size:11px;line-height:1.5;box-sizing:border-box;">
${headerHtml}
${executiveSummaryHtml}
${scopeHtml}
${technicalApproachHtml}
${milestonesHtml}
${bidItemsHtml}
${inclusionsHtml}
${exclusionsHtml}
${clarificationsHtml}
${assumptionsHtml}
${logisticsHtml}
${risksHtml}
${paymentTermsHtml}
${changeOrderHtml}
${warrantyHtml}
${closingHtml}
${acceptanceHtml}
${footerHtml}
</div>`;

  return { client, scope, total, duration, bid_items, executive_summary, technical_approach, major_milestones: milestoneItemsList, logistics_plan, project_risks: riskItemsList, html, theme };
}

async function proposalHandler(req, res) {
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
    const result = buildProposal({
      client:          body.client || body.client_name || 'Project',
      scope:           body.scope || '',
      total:           parseFloat(body.total) || 0,
      duration:        body.duration != null ? parseInt(body.duration, 10) : null,
      executive_summary: body.executive_summary || '',
      technical_approach: body.technical_approach || '',
      assumptions:     body.assumptions || '',
      exclusions:      body.exclusions || '',
      inclusions:      body.inclusions || '',
      closing_note:    body.closing_note || '',
      bid_items:       body.bid_items || [],
      logistics_plan:  body.logistics_plan || '',
      major_milestones: body.major_milestones || [],
      project_risks:   body.project_risks || [],
      company_name:    body.company_name || '',
      company_contact: body.company_contact || '',
      company_phone:   body.company_phone || '',
      company_email:   body.company_email || '',
      company_url:     body.company_url || '',
      company_logo:    body.company_logo || '',
      payment_terms:   body.payment_terms || '',
      change_order_terms: body.change_order_terms || '',
      warranty:        body.warranty || '',
      validity_days:   body.validity_days != null ? parseInt(body.validity_days, 10) : 30,
      theme:           body.theme === 'dark' ? 'dark' : 'light',
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('Proposal error:', err);
    return res.status(500).json({ error: err.message || 'Proposal generation failed' });
  }
}

proposalHandler.buildProposal = buildProposal;
module.exports = proposalHandler;
