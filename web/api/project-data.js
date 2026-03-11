const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in to sync project data.', project_data: null });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Server misconfigured', project_data: null });
  }

  const supabase = createClient(url, key);

  try {
    const projectId = String((req.query && (req.query.project_id || req.query.id)) || (req.body && req.body.project_id) || '').trim();
    if (!projectId) {
      return res.status(400).json({ error: 'project_id required', project_data: null });
    }
    const project = await ensureOwnedProject(supabase, user.id, projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found', project_data: null });
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('project_state')
        .select('data, updated_at')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({
        project_id: projectId,
        project_data: data && data.data && typeof data.data === 'object' ? data.data : {},
        updated_at: data && data.updated_at ? data.updated_at : null,
      });
    }

    if (req.method === 'PUT') {
      const incoming = req.body && typeof req.body.project_data === 'object' && req.body.project_data
        ? req.body.project_data
        : {};
      const nowIso = new Date().toISOString();
      const { data: existing, error: existingError } = await supabase
        .from('project_state')
        .select('project_id')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { data, error } = await supabase
          .from('project_state')
          .update({ data: incoming, updated_at: nowIso })
          .eq('project_id', projectId)
          .eq('user_id', user.id)
          .select('data, updated_at')
          .single();
        if (error) throw error;
        return res.status(200).json({
          project_id: projectId,
          project_data: data && data.data && typeof data.data === 'object' ? data.data : {},
          updated_at: data && data.updated_at ? data.updated_at : nowIso,
        });
      }

      const { data, error } = await supabase
        .from('project_state')
        .insert({
          project_id: projectId,
          user_id: user.id,
          data: incoming,
          updated_at: nowIso,
        })
        .select('data, updated_at')
        .single();
      if (error) throw error;
      return res.status(200).json({
        project_id: projectId,
        project_data: data && data.data && typeof data.data === 'object' ? data.data : {},
        updated_at: data && data.updated_at ? data.updated_at : nowIso,
      });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('project_state')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', user.id);
      if (error) throw error;
      return res.status(200).json({ ok: true, project_id: projectId });
    }

    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed', project_data: null });
  } catch (e) {
    console.error('Project data API error:', e);
    return res.status(500).json({ error: e.message || 'Server error', project_data: null });
  }
};
