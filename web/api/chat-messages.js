const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');

function normalizeCreatedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in to sync chat history.', messages: [] });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Server misconfigured', messages: [] });
  }

  const supabase = createClient(url, key);

  try {
    if (req.method === 'GET') {
      const projectId = req.query?.project_id;
      if (!projectId) {
        return res.status(400).json({ error: 'project_id required', messages: [] });
      }
      const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).single();
      if (!project) {
        return res.status(404).json({ error: 'Project not found', messages: [] });
      }
      const { data, error } = await supabase
        .from('chat_messages')
        .select('role, content, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const messages = (data || []).map((m) => ({
        role: m.role,
        content: m.content || '',
        createdAt: m.created_at || null,
      }));
      return res.status(200).json({ messages });
    }

    if (req.method === 'POST') {
      const { project_id, role, content } = req.body || {};
      if (!project_id || !role) {
        return res.status(400).json({ error: 'project_id and role required', message: null });
      }
      const { data: project } = await supabase.from('projects').select('id').eq('id', project_id).eq('user_id', user.id).single();
      if (!project) {
        return res.status(404).json({ error: 'Project not found', message: null });
      }
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({ project_id, role, content: String(content || '') })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ message: data });
    }

    if (req.method === 'PUT') {
      const { project_id, messages } = req.body || {};
      if (!project_id || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'project_id and messages array required', messages: [] });
      }
      const { data: project } = await supabase.from('projects').select('id').eq('id', project_id).eq('user_id', user.id).single();
      if (!project) {
        return res.status(404).json({ error: 'Project not found', messages: [] });
      }
      await supabase.from('chat_messages').delete().eq('project_id', project_id);
      if (messages.length > 0) {
        const rows = messages.map((m) => {
          const row = {
            project_id,
            role: m.role || 'user',
            content: String(m.content || ''),
          };
          const createdAt = normalizeCreatedAt(m.createdAt || m.created_at || m.timestamp || null);
          if (createdAt) row.created_at = createdAt;
          return row;
        });
        const { error } = await supabase.from('chat_messages').insert(rows);
        if (error) throw error;
      }
      return res.status(200).json({ messages });
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Chat messages API error:', e);
    return res.status(500).json({ error: e.message || 'Server error', messages: [] });
  }
};
