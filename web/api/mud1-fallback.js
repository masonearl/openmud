/**
 * mud1 RAG endpoint: True RAG — retrieve from knowledge base → LLM generates grounded response.
 * Every mud1 question flows through: retrieve relevant data → inject into LLM context → generate.
 */
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');
const { allocateUsage, logUsageEvent, detectSource } = require('./lib/usage');
const { getRAGContextForUser, getRAGPackageForUser, buildMud1RAGSystemPrompt } = require('./lib/mud1-rag');
const { getProjectRAGPackage } = require('./lib/project-rag-store');
const { maxConfidence, mergeRagSources } = require('./lib/rag-utils');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', response: null });
  }

  try {
    const { messages, project_id } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required', response: null });
    }

    const user = await getUserFromRequest(req);
    if (user) {
      const alloc = await allocateUsage(user.id, user.email);
      if (!alloc.allowed) {
        return res.status(429).json({
          error: `Daily limit reached (${alloc.used}/${alloc.limit}). Upgrade at openmud.ai/subscribe.html`,
          response: null,
          usage: { used: alloc.used, limit: alloc.limit, date: alloc.date },
        });
      }
    }
    // No auth: allow desktop/app use without sign-in (usage not tracked)

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY not configured',
        response: null,
      });
    }

    const openai = new OpenAI({ apiKey });
    const chatMessages = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    }));

    // True RAG: retrieve relevant context → inject into LLM
    const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
    const userText = lastUser ? String(lastUser.content || '').trim() : '';
    const ragPkg = getRAGPackageForUser(userText, 5);
    const kbContext = (ragPkg && ragPkg.context) ? ragPkg.context : getRAGContextForUser(userText);
    let projectRag = null;
    if (user && project_id) {
      try {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (url && key) {
          const supabase = createClient(url, key);
          projectRag = await getProjectRAGPackage({
            projectId: project_id,
            query: userText,
            userId: user.id,
            topK: 6,
            supabaseClient: supabase,
          });
        }
      } catch (e) {
        projectRag = null;
      }
    }
    const retrievedContext = (projectRag && projectRag.context)
      ? `## Project documents and imported email context (highest priority)\n${projectRag.context}\n\n## Construction knowledge base\n${kbContext}`
      : kbContext;
    const systemPrompt = buildMud1RAGSystemPrompt(retrievedContext);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
      max_tokens: 512,
      temperature: 0.5,
    });

    const text = completion.choices?.[0]?.message?.content || 'What can I help with?';
    if (user) {
      const usage = completion.usage || {};
      await logUsageEvent(user.id, {
        model: 'mud1',
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        source: detectSource(req),
        requestType: 'chat',
      });
    }
    return res.status(200).json({
      response: text.trim(),
      tools_used: [],
      rag: {
        confidence: maxConfidence(
          (projectRag && projectRag.confidence) || 'low',
          (ragPkg && ragPkg.confidence) || 'low'
        ),
        fallback_used: ((projectRag && projectRag.fallback_used) !== false) && !!(ragPkg && ragPkg.fallback_used),
        sources: mergeRagSources(
          (projectRag && projectRag.sources) || [],
          (ragPkg && Array.isArray(ragPkg.sources)) ? ragPkg.sources : []
        ),
      },
    });
  } catch (err) {
    console.error('mud1-fallback error:', err);
    const msg = err?.message || String(err);
    return res.status(500).json({
      error: msg,
      response: "Something went wrong. Try again or ask something construction-specific.",
    });
  }
};
