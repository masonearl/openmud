/**
 * mud1 Ollama client — local LLM inference.
 * Tries the best available model automatically; falls back gracefully.
 */

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';

// Model preference order — best quality first. Ollama will use whichever is pulled.
const MODEL_PREFERENCE = [
  'llama3.1:8b',
  'llama3.2:3b',
  'llama3.2:1b',
  'mistral:7b',
  'mistral:latest',
  'llama2:7b',
  'tinyllama:latest',
  'tinyllama',
];

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'tinyllama';

let _bestModel = null; // cached after first check

/**
 * Check if Ollama is reachable.
 */
async function isOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get list of pulled models from Ollama.
 */
async function getAvailableModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name || '');
  } catch {
    return [];
  }
}

/**
 * Pick the best available model from our preference list.
 * Falls back to OLLAMA_MODEL env if nothing from our list is found.
 */
async function getBestModel() {
  if (_bestModel) return _bestModel;
  try {
    const available = await getAvailableModels();
    if (!available.length) return OLLAMA_MODEL;
    for (const preferred of MODEL_PREFERENCE) {
      const match = available.find(
        (m) => m === preferred || m.startsWith(preferred.split(':')[0] + ':')
      );
      if (match) {
        _bestModel = match;
        return match;
      }
    }
    // Fall back to first available model
    _bestModel = available[0];
    return _bestModel;
  } catch {
    return OLLAMA_MODEL;
  }
}

/**
 * Determine if a model is small/weak (needs more guidance, shorter output).
 */
function isSmallModel(modelName) {
  const small = ['tinyllama', 'llama3.2:1b', 'llama2:7b', 'phi'];
  return small.some((s) => (modelName || '').toLowerCase().includes(s.split(':')[0]));
}

/**
 * Build optimal model options based on model size and task type.
 */
function buildModelOptions(model, opts = {}) {
  const small = isSmallModel(model);
  return {
    // Lower temperature = more factual, less hallucination. Small models need this more.
    temperature: opts.temperature !== undefined ? opts.temperature : (small ? 0.2 : 0.35),
    // Limit output tokens — small models ramble; keep responses tight
    num_predict: opts.max_tokens || (small ? 512 : 1024),
    // Increase context window for better coherence
    num_ctx: small ? 2048 : 4096,
    // Reduce repetition
    repeat_penalty: 1.15,
    // Top-p sampling — keep it focused
    top_p: 0.85,
    // Top-k — limit vocabulary choices for more consistent output
    top_k: small ? 30 : 50,
  };
}

/**
 * Trim the system prompt for small models to avoid context overflow.
 */
function trimSystemForModel(system, model) {
  if (!system) return '';
  // Small models choke on long system prompts — truncate to ~1200 chars
  if (isSmallModel(model) && system.length > 1200) {
    return system.slice(0, 1200) + '\n\n[Keep response short and practical.]';
  }
  return system;
}

/**
 * Chat completion via Ollama.
 * Automatically selects best available model if not specified.
 *
 * @param {object} opts
 * @param {string} opts.system - System prompt
 * @param {Array<{role: string, content: string}>} opts.messages - Chat history
 * @param {number} [opts.max_tokens=1024]
 * @param {number} [opts.temperature]
 * @param {string} [opts.model] - Override model (default: auto-selected best)
 * @returns {Promise<{text: string, done: boolean, model: string}>}
 */
async function chat(opts) {
  const { system, messages, max_tokens, temperature, model: modelOverride } = opts || {};

  const model = modelOverride || (await getBestModel());
  const trimmedSystem = trimSystemForModel(system, model);
  const modelOptions = buildModelOptions(model, { max_tokens, temperature });

  const body = {
    model,
    messages: messages || [],
    stream: false,
    options: modelOptions,
  };

  if (trimmedSystem) {
    body.messages = [{ role: 'system', content: trimmedSystem }, ...(body.messages || [])];
  }

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000), // 90s — larger models take longer
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error ${res.status}: ${err}`);
  }

  const data = await res.json();
  let text = data.message?.content || '';

  // Post-process: remove common small-model artifacts
  text = cleanModelOutput(text, model);

  return {
    text,
    done: data.done,
    model,
    usage: {
      prompt_tokens: Number(data.prompt_eval_count) || 0,
      completion_tokens: Number(data.eval_count) || 0,
    },
  };
}

/**
 * Clean up common small-model output artifacts.
 */
function cleanModelOutput(text, model) {
  if (!text) return '';
  // Remove repetitive self-identification that tinyllama sometimes adds
  text = text.replace(/^(As (an AI|mud1|a language model|an assistant)[,.]?\s*)/i, '');
  // Remove trailing whitespace and fix multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  // Remove "Is there anything else..." boilerplate that wastes space
  text = text.replace(/\n*(Is there (anything|something) else I can help (you with|with)\??\.?|Let me know if you (need|have) (anything|any questions)\.?)\s*$/i, '');
  return text;
}

/**
 * Invalidate model cache (call after a new model is pulled).
 */
function resetModelCache() {
  _bestModel = null;
}

module.exports = {
  isOllamaAvailable,
  getAvailableModels,
  getBestModel,
  chat,
  resetModelCache,
  OLLAMA_BASE,
  OLLAMA_MODEL,
};
