const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
    return res.status(401).json({ error: 'Sign in to sync documents.' });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    // GET /api/sync-manifest?project_id=...
    // Returns the server manifest for a project so the client can compute a diff.
    if (req.method === 'GET') {
      const projectId = (req.query && req.query.project_id) || '';
      if (!projectId) {
        return res.status(400).json({ error: 'project_id required' });
      }

      const { data, error } = await supabase
        .from('sync_manifest')
        .select('*')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });
      if (error) throw error;

      // Also fetch unresolved conflicts
      const { data: conflicts, error: conflictErr } = await supabase
        .from('sync_conflicts')
        .select('*')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .is('resolved_at', null)
        .order('created_at', { ascending: false });
      if (conflictErr) throw conflictErr;

      return res.status(200).json({
        manifest: data || [],
        conflicts: conflicts || [],
        server_time: new Date().toISOString(),
      });
    }

    // POST /api/sync-manifest — client pushes its local manifest entries.
    // Server compares with its state and returns actions: upload, download, conflict.
    if (req.method === 'POST') {
      const body = req.body || {};
      const projectId = body.project_id || '';
      const clientEntries = Array.isArray(body.entries) ? body.entries : [];

      if (!projectId) {
        return res.status(400).json({ error: 'project_id required' });
      }

      // Fetch server manifest for this project
      const { data: serverEntries, error: fetchErr } = await supabase
        .from('sync_manifest')
        .select('*')
        .eq('user_id', user.id)
        .eq('project_id', projectId);
      if (fetchErr) throw fetchErr;

      const serverMap = {};
      (serverEntries || []).forEach((e) => { serverMap[e.doc_id] = e; });

      const actions = [];
      const upserts = [];
      const conflicts = [];
      const now = new Date().toISOString();
      const clientIds = new Set();

      for (const ce of clientEntries) {
        clientIds.add(ce.doc_id);
        const se = serverMap[ce.doc_id];

        if (!se) {
          // New on client — server should accept it
          actions.push({ doc_id: ce.doc_id, action: 'accept', source: 'client' });
          upserts.push({
            user_id: user.id,
            project_id: projectId,
            doc_id: ce.doc_id,
            doc_name: ce.doc_name || '',
            folder_path: ce.folder_path || '',
            content_hash: ce.content_hash || '',
            byte_size: ce.byte_size || 0,
            version: ce.version || 1,
            source: ce.source || 'web',
            updated_at: ce.updated_at || now,
            created_at: ce.created_at || now,
            deleted_at: ce.deleted_at || null,
          });
          continue;
        }

        // Both exist — compare hashes and versions
        if (ce.content_hash === se.content_hash) {
          // Same content, no action needed
          actions.push({ doc_id: ce.doc_id, action: 'none' });
          continue;
        }

        // Content differs — check who is newer
        const clientNewer = (ce.updated_at || '') > (se.updated_at || '');
        const serverNewer = (se.updated_at || '') > (ce.updated_at || '');

        if (clientNewer) {
          actions.push({ doc_id: ce.doc_id, action: 'accept', source: 'client' });
          upserts.push({
            user_id: user.id,
            project_id: projectId,
            doc_id: ce.doc_id,
            doc_name: ce.doc_name || se.doc_name || '',
            folder_path: ce.folder_path || se.folder_path || '',
            content_hash: ce.content_hash || '',
            byte_size: ce.byte_size || 0,
            version: Math.max(ce.version || 0, se.version || 0) + 1,
            source: ce.source || 'web',
            updated_at: now,
            deleted_at: ce.deleted_at || null,
          });
        } else if (serverNewer) {
          actions.push({
            doc_id: ce.doc_id,
            action: 'download',
            server_entry: se,
          });
        } else {
          // Same timestamp but different hash — conflict
          actions.push({ doc_id: ce.doc_id, action: 'conflict' });
          conflicts.push({
            user_id: user.id,
            project_id: projectId,
            doc_id: ce.doc_id,
            doc_name: ce.doc_name || se.doc_name || '',
            local_hash: ce.content_hash || '',
            remote_hash: se.content_hash || '',
            local_version: ce.version || 0,
            remote_version: se.version || 0,
            local_source: ce.source || 'web',
            remote_source: se.source || 'web',
            created_at: now,
          });
        }
      }

      // Server-only entries (deleted on client or never synced to client)
      for (const se of (serverEntries || [])) {
        if (!clientIds.has(se.doc_id) && !se.deleted_at) {
          actions.push({
            doc_id: se.doc_id,
            action: 'download',
            server_entry: se,
          });
        }
      }

      // Apply upserts
      if (upserts.length) {
        const { error: upsertErr } = await supabase
          .from('sync_manifest')
          .upsert(upserts, { onConflict: 'user_id,project_id,doc_id' });
        if (upsertErr) throw upsertErr;
      }

      // Log conflicts
      if (conflicts.length) {
        const { error: conflictErr } = await supabase
          .from('sync_conflicts')
          .insert(conflicts);
        if (conflictErr) console.error('Conflict logging error:', conflictErr);
      }

      return res.status(200).json({
        actions,
        conflicts_detected: conflicts.length,
        synced_at: now,
      });
    }

    // PUT /api/sync-manifest — resolve a conflict
    if (req.method === 'PUT') {
      const body = req.body || {};
      const conflictId = body.conflict_id || '';
      const resolution = body.resolution || '';

      if (!conflictId || !resolution) {
        return res.status(400).json({ error: 'conflict_id and resolution required' });
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('sync_conflicts')
        .update({ resolution, resolved_at: now })
        .eq('user_id', user.id)
        .eq('id', conflictId);
      if (error) throw error;

      return res.status(200).json({ ok: true, conflict_id: conflictId, resolution });
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Sync manifest API error:', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
