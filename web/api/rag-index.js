const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');
const { indexDocument } = require('./lib/project-rag-store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const { project_id, document_id, title, source, source_meta, text } = req.body || {};
  if (!project_id || !text) {
    return res.status(400).json({ error: 'project_id and text are required' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Server misconfigured' });

  const supabase = createClient(url, key);
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', project_id)
    .eq('user_id', user.id)
    .single();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const result = indexDocument({
      projectId: project_id,
      documentId: document_id,
      title,
      source,
      sourceMeta: source_meta,
      text,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Indexing failed' });
  }
};
