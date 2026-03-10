const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in to sync projects.', projects: [] });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Server misconfigured', projects: [] });
  }

  const supabase = createClient(url, key);

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, created_at, updated_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ projects: data || [] });
    }

    if (req.method === 'POST') {
      const { id, name } = req.body || {};
      if (!id || !name) {
        return res.status(400).json({ error: 'id and name required', project: null });
      }
      const { data, error } = await supabase
        .from('projects')
        .upsert({ id, user_id: user.id, name: String(name).trim(), updated_at: new Date().toISOString() }, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ project: data });
    }

    if (req.method === 'PUT') {
      const { projects } = req.body || {};
      if (!Array.isArray(projects)) {
        return res.status(400).json({ error: 'projects array required', projects: [] });
      }
      const rows = projects.map((p) => ({
        id: p.id,
        user_id: user.id,
        name: (p.name || 'Untitled project').trim(),
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('projects').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      return res.status(200).json({ projects: rows });
    }

    if (req.method === 'DELETE') {
      const projectId = String((req.query && req.query.id) || (req.body && req.body.id) || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'id required', project: null });
      }
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!project) {
        return res.status(404).json({ error: 'Project not found', project: null });
      }
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('user_id', user.id);
      if (error) throw error;
      console.log(JSON.stringify({
        event: 'project_deleted',
        user_id: user.id,
        project_id: projectId,
      }));
      return res.status(200).json({ ok: true, id: projectId });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Projects API error:', e);
    return res.status(500).json({ error: e.message || 'Server error', projects: [] });
  }
};
