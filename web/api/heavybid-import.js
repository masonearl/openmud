const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');
const { indexDocument } = require('./lib/project-rag-store');

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${proto}://${host}` : 'http://localhost:3000';
}

function buildInternalHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OPENMUD_API_KEY) headers['x-api-key'] = process.env.OPENMUD_API_KEY;
  return headers;
}

async function ensureOwnedProject(supabase, userId, projectId) {
  const { data: project, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return project || null;
}

function buildRagText(snapshot) {
  const lines = [];
  const counts = snapshot.counts || {};
  lines.push(`HeavyBid snapshot generated at ${snapshot.generated_at || ''}.`);
  lines.push(`Imported ${counts.bids || 0} bids, ${counts.bid_items || 0} bid items, ${counts.crew_library || 0} crews, ${counts.formulas || 0} formulas.`);

  (snapshot.bids || []).slice(0, 200).forEach((bid) => {
    lines.push(
      `Estimate ${bid.estimate_code || ''}: ${bid.project_name || ''}; bid total ${bid.bid_total || 0}; direct cost ${bid.direct_cost_total || 0}; source ${bid.source_kind || ''}.`
    );
  });

  (snapshot.bid_items || []).slice(0, 2500).forEach((item) => {
    lines.push(
      `Estimate ${item.estimate_code || ''} item ${item.item_code || ''}: ${item.description || ''}; quantity ${item.quantity || 0} ${item.unit || ''}; unit price ${item.unit_price || 0}; amount ${item.amount || 0}; manhours ${item.manhours || 0}; crew ${item.crew_code || ''}.`
    );
  });

  (snapshot.private_kb || []).slice(0, 200).forEach((entry) => {
    lines.push(`${entry.title || 'HeavyBid note'}: ${entry.content || ''}`);
  });

  (snapshot.formulas || []).slice(0, 40).forEach((formula) => {
    const firstFormula = (formula.formula_cells || [])[0];
    if (!firstFormula) return;
    lines.push(
      `Formula template ${formula.template_name || ''}: ${firstFormula.formula || ''} from ${firstFormula.sheet || ''} ${firstFormula.cell || ''}.`
    );
  });

  return lines.join('\n');
}

function buildProductionBenchmarks(items) {
  return (items || [])
    .filter((item) => Number(item.quantity) > 0 && Number(item.manhours) > 0)
    .slice(0, 500)
    .map((item) => ({
      estimate_code: item.estimate_code || '',
      description: item.description || '',
      unit: item.unit || '',
      quantity: Number(item.quantity) || 0,
      manhours: Number(item.manhours) || 0,
      units_per_manhour: Number(item.quantity) && Number(item.manhours)
        ? Number((Number(item.quantity) / Number(item.manhours)).toFixed(4))
        : 0,
      crew_code: item.crew_code || '',
      source_kind: item.source_kind || '',
    }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Server misconfigured' });

  const supabase = createClient(url, key);

  try {
    const { project_id, source_dir, write_outputs = true } = req.body || {};
    const projectId = String(project_id || '').trim();
    if (!projectId || !source_dir) {
      return res.status(400).json({ error: 'project_id and source_dir are required' });
    }

    const project = await ensureOwnedProject(supabase, user.id, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const baseUrl = getBaseUrl(req);
    const response = await fetch(`${baseUrl}/api/python/heavybid`, {
      method: 'POST',
      headers: buildInternalHeaders(),
      body: JSON.stringify({
        action: 'snapshot',
        source_dir: source_dir,
        write_outputs: Boolean(write_outputs),
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.result) {
      return res.status(500).json({ error: payload.error || 'HeavyBid snapshot failed' });
    }

    const snapshot = payload.result;
    const importId = `heavybid_${Date.now()}`;
    const importMeta = {
      import_id: importId,
      imported_at: new Date().toISOString(),
      source_dir: source_dir,
      generated_at: snapshot.generated_at || '',
      counts: snapshot.counts || {},
    };

    const { data: existing } = await supabase
      .from('project_state')
      .select('data')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    const prior = existing && existing.data && typeof existing.data === 'object' ? existing.data : {};
    const nextData = {
      ...prior,
      heavybid_imports: [...(Array.isArray(prior.heavybid_imports) ? prior.heavybid_imports : []), importMeta],
      heavybid_snapshot: {
        generated_at: snapshot.generated_at || '',
        source_dir: source_dir,
        counts: snapshot.counts || {},
      },
      heavybid_bid_items: (snapshot.bid_items || []).slice(0, 2500),
      heavybid_crews: (snapshot.crew_library || []).slice(0, 1000),
      heavybid_rate_library: 'heavybid_derived',
      production_benchmarks: buildProductionBenchmarks(snapshot.bid_items),
      bid_items: Array.isArray(prior.bid_items) && prior.bid_items.length
        ? prior.bid_items
        : (snapshot.bid_items || []).slice(0, 250).map((item) => ({
          description: item.description || 'Bid item',
          quantity: item.quantity || null,
          unit: item.unit || 'LS',
          unit_price: item.unit_price || null,
          amount: item.amount || null,
        })),
      rate_overrides: {
        ...(prior.rate_overrides || {}),
        heavybid_rate_library: 'heavybid_derived',
      },
    };

    await supabase
      .from('project_state')
      .upsert({
        project_id: projectId,
        user_id: user.id,
        data: nextData,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,user_id' });

    indexDocument({
      projectId,
      documentId: importId,
      title: `HeavyBid import ${snapshot.generated_at || ''}`.trim(),
      source: 'heavybid-import',
      sourceMeta: {
        import_id: importId,
        source_dir: source_dir,
      },
      text: buildRagText(snapshot),
    });

    return res.status(200).json({
      ok: true,
      import_id: importId,
      project_id: projectId,
      counts: snapshot.counts || {},
      project_data: nextData,
    });
  } catch (e) {
    console.error('HeavyBid import error:', e);
    return res.status(500).json({ error: e.message || 'HeavyBid import failed' });
  }
};
