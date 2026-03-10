const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');

function normalizeObject(value, fallback) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return value;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in to sync project state.', project_state: null });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Server misconfigured', project_state: null });
  }

  const supabase = createClient(url, key);

  try {
    if (req.method === 'GET') {
      const projectId = String((req.query && req.query.project_id) || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'project_id required', project_state: null });
      }

      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!project) {
        return res.status(404).json({ error: 'Project not found', project_state: null });
      }

      const { data, error } = await supabase
        .from('project_state')
        .select('project_id, project_data_json, chats_json, active_chat_id, updated_at')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;

      return res.status(200).json({
        project_state: data ? {
          project_id: data.project_id,
          project_data: normalizeObject(data.project_data_json, {}),
          chats: normalizeObject(data.chats_json, {}),
          active_chat_id: data.active_chat_id || null,
          updated_at: data.updated_at || null,
        } : null,
      });
    }

    if (req.method === 'PUT') {
      const projectId = String((req.body && req.body.project_id) || '').trim();
      if (!projectId) {
        return res.status(400).json({ error: 'project_id required', project_state: null });
      }

      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!project) {
        return res.status(404).json({ error: 'Project not found', project_state: null });
      }

      const payload = {
        project_id: projectId,
        user_id: user.id,
        project_data_json: normalizeObject(req.body && req.body.project_data, {}),
        chats_json: normalizeObject(req.body && req.body.chats, {}),
        active_chat_id: req.body && req.body.active_chat_id ? String(req.body.active_chat_id) : null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('project_state')
        .upsert(payload, { onConflict: 'project_id' })
        .select('project_id, project_data_json, chats_json, active_chat_id, updated_at')
        .single();
      if (error) throw error;

      return res.status(200).json({
        project_state: {
          project_id: data.project_id,
          project_data: normalizeObject(data.project_data_json, {}),
          chats: normalizeObject(data.chats_json, {}),
          active_chat_id: data.active_chat_id || null,
          updated_at: data.updated_at || null,
        },
      });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed', project_state: null });
  } catch (err) {
    console.error(JSON.stringify({
      event: 'project_state_api_error',
      user_id: user.id,
      project_id: (req.query && req.query.project_id) || (req.body && req.body.project_id) || null,
      method: req.method,
      message: err.message || 'Unknown error',
    }));
    return res.status(500).json({ error: err.message || 'Server error', project_state: null });
  }
};
