const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in to sync tasks.' });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    // GET /api/tasks?project_id=...&since=...
    if (req.method === 'GET') {
      const projectId = (req.query && req.query.project_id) || '';
      const since = (req.query && req.query.since) || '';

      let query = supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (projectId) query = query.eq('project_id', projectId);
      if (since) query = query.gte('updated_at', since);

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ tasks: data || [] });
    }

    // POST /api/tasks — upsert one or more tasks
    if (req.method === 'POST') {
      const body = req.body || {};
      const incoming = Array.isArray(body.tasks) ? body.tasks : (body.task ? [body.task] : []);
      if (!incoming.length) {
        return res.status(400).json({ error: 'tasks array or task object required' });
      }

      const now = new Date().toISOString();
      const rows = incoming.map((t) => ({
        id: t.id || crypto.randomUUID(),
        project_id: t.project_id || '',
        user_id: user.id,
        title: (t.title || 'Untitled task').trim(),
        notes: (t.notes || '').trim(),
        status: t.status || 'open',
        priority: t.priority || 'medium',
        due_at: t.due_at || null,
        completed_at: t.completed_at || null,
        source: t.source || 'manual',
        version: (t.version || 0) + 1,
        created_at: t.created_at || now,
        updated_at: now,
        deleted_at: t.deleted_at || null,
      }));

      const { data, error } = await supabase
        .from('tasks')
        .upsert(rows, { onConflict: 'user_id,id' })
        .select();
      if (error) throw error;
      return res.status(200).json({ tasks: data || rows });
    }

    // PUT /api/tasks — bulk sync: client sends full task list, server merges
    if (req.method === 'PUT') {
      const body = req.body || {};
      const clientTasks = Array.isArray(body.tasks) ? body.tasks : [];
      const projectId = body.project_id || '';
      const lastSyncAt = body.last_sync_at || '';

      // Fetch server state for comparison
      let serverQuery = supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id);
      if (projectId) serverQuery = serverQuery.eq('project_id', projectId);

      const { data: serverTasks, error: fetchErr } = await serverQuery;
      if (fetchErr) throw fetchErr;

      const serverMap = {};
      (serverTasks || []).forEach((t) => { serverMap[t.id] = t; });

      const now = new Date().toISOString();
      const merged = [];
      const clientIds = new Set();

      // Merge client tasks: client wins if version >= server version
      clientTasks.forEach((ct) => {
        clientIds.add(ct.id);
        const st = serverMap[ct.id];
        if (!st) {
          merged.push({
            id: ct.id,
            project_id: ct.project_id || projectId || '',
            user_id: user.id,
            title: (ct.title || 'Untitled task').trim(),
            notes: (ct.notes || '').trim(),
            status: ct.status || 'open',
            priority: ct.priority || 'medium',
            due_at: ct.due_at || null,
            completed_at: ct.completed_at || null,
            source: ct.source || 'manual',
            version: ct.version || 1,
            created_at: ct.created_at || now,
            updated_at: now,
            deleted_at: ct.deleted_at || null,
          });
        } else {
          // Last-write-wins by updated_at, with version as tiebreaker
          const clientNewer = (ct.updated_at || '') > (st.updated_at || '') ||
            ((ct.updated_at || '') === (st.updated_at || '') && (ct.version || 0) >= (st.version || 0));
          const winner = clientNewer ? ct : st;
          merged.push({
            id: winner.id,
            project_id: winner.project_id || projectId || '',
            user_id: user.id,
            title: (winner.title || 'Untitled task').trim(),
            notes: (winner.notes || '').trim(),
            status: winner.status || 'open',
            priority: winner.priority || 'medium',
            due_at: winner.due_at || null,
            completed_at: winner.completed_at || null,
            source: winner.source || 'manual',
            version: Math.max(ct.version || 0, st.version || 0) + 1,
            created_at: winner.created_at || now,
            updated_at: now,
            deleted_at: winner.deleted_at || null,
          });
        }
      });

      // Server-only tasks (not on client) — include them in the response
      (serverTasks || []).forEach((st) => {
        if (!clientIds.has(st.id)) {
          merged.push(st);
        }
      });

      // Upsert merged results
      if (merged.length) {
        const { error: upsertErr } = await supabase
          .from('tasks')
          .upsert(merged, { onConflict: 'user_id,id' });
        if (upsertErr) throw upsertErr;
      }

      return res.status(200).json({
        tasks: merged,
        synced_at: now,
      });
    }

    // DELETE /api/tasks?id=...
    if (req.method === 'DELETE') {
      const taskId = (req.query && req.query.id) || (req.body && req.body.id) || '';
      if (!taskId) {
        return res.status(400).json({ error: 'id required' });
      }

      // Soft delete: set deleted_at and bump version
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('tasks')
        .update({ deleted_at: now, updated_at: now, version: supabase.rpc ? undefined : 1 })
        .eq('user_id', user.id)
        .eq('id', taskId);
      if (error) throw error;
      return res.status(200).json({ ok: true, id: taskId, deleted_at: now });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Tasks API error:', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
