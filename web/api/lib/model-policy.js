const MODEL_POLICIES = {
  mud1: {
    id: 'mud1',
    label: 'mud1',
    provider: 'openmud',
    access: 'hosted_free',
    recommended: true,
    badge: 'Free',
    short_description: 'Best default for openmud. Free and available without a provider key.',
    best_for: 'Construction chat, estimates, proposals, schedules, and general project work.',
  },
  openclaw: {
    id: 'openclaw',
    label: 'openmud agent',
    provider: 'openmud',
    access: 'desktop_agent',
    badge: 'Desktop',
    short_description: 'Uses your linked Mac tools for email, calendar, files, and system actions.',
    best_for: 'Computer-linked workflows that need your Mac.',
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai',
    access: 'hosted_beta',
    badge: 'Hosted beta',
    short_description: 'Fast hosted model from openmud. Available during beta with platform limits.',
    best_for: 'Fast general chat when you want a hosted model.',
  },
  'claude-3-haiku-20240307': {
    id: 'claude-3-haiku-20240307',
    label: 'Claude Haiku 3',
    provider: 'anthropic',
    access: 'hosted_beta',
    badge: 'Hosted beta',
    short_description: 'Lightweight hosted Claude option during beta.',
    best_for: 'Quick drafting and concise reasoning.',
  },
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    access: 'hosted_beta',
    badge: 'Hosted beta',
    short_description: 'Stronger hosted Claude option during beta with the same platform limits.',
    best_for: 'Sharper reasoning without moving to premium BYOK models.',
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    access: 'hosted_beta',
    badge: 'Hosted beta',
    short_description: 'Stronger hosted Claude option during beta with the same platform limits.',
    best_for: 'Sharper reasoning without moving to premium BYOK models.',
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    access: 'byok',
    badge: 'BYOK',
    short_description: 'Premium Claude model. Add your own Anthropic key in Settings.',
    best_for: 'Deeper reasoning when you want to use your own provider account.',
  },
  'grok-2-latest': {
    id: 'grok-2-latest',
    label: 'Grok 2',
    provider: 'grok',
    access: 'byok',
    badge: 'BYOK',
    short_description: 'Premium Grok model. Add your own xAI key in Settings.',
    best_for: 'Alternate premium model access through your own key.',
  },
  'openrouter/openai/gpt-4o-mini': {
    id: 'openrouter/openai/gpt-4o-mini',
    label: 'OpenRouter GPT-4o mini',
    provider: 'openrouter',
    access: 'byok',
    badge: 'BYOK',
    short_description: 'Use your own OpenRouter account for OpenAI-compatible models.',
    best_for: 'Users who want routing through OpenRouter.',
  },
};

const PUBLIC_MODEL_ORDER = [
  'mud1',
  'openclaw',
  'gpt-4o-mini',
  'claude-3-haiku-20240307',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'grok-2-latest',
  'openrouter/openai/gpt-4o-mini',
];

function getModelPolicy(modelId) {
  const id = String(modelId || '').trim();
  if (MODEL_POLICIES[id]) return MODEL_POLICIES[id];
  return {
    id: id || 'unknown',
    label: id || 'Unknown model',
    provider: 'unknown',
    access: 'byok',
    badge: 'BYOK',
    short_description: 'Unknown model. Treat as bring-your-own-key only.',
    best_for: 'Advanced users with their own provider access.',
  };
}

function isHostedFreeModel(modelId) {
  return getModelPolicy(modelId).access === 'hosted_free';
}

function isHostedBetaModel(modelId) {
  return getModelPolicy(modelId).access === 'hosted_beta';
}

function isHostedModel(modelId) {
  const access = getModelPolicy(modelId).access;
  return access === 'hosted_free' || access === 'hosted_beta';
}

function isByokModel(modelId) {
  return getModelPolicy(modelId).access === 'byok';
}

function isDesktopAgentModel(modelId) {
  return getModelPolicy(modelId).access === 'desktop_agent';
}

function getRequiredProviderKey(modelId) {
  const provider = getModelPolicy(modelId).provider;
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'grok') return 'grok';
  if (provider === 'openrouter') return 'openrouter';
  if (provider === 'openai') return 'openai';
  return '';
}

function classifyUsageKind({ model, usingOwnKey, source, requestType }) {
  const policy = getModelPolicy(model);
  if (String(requestType || '').indexOf(':') >= 0) {
    const suffix = String(requestType || '').split(':').pop();
    if (suffix) return suffix;
  }
  if (policy.access === 'desktop_agent') return 'desktop_agent';
  if (source === 'desktop' && policy.id === 'mud1') return 'local_desktop';
  if (usingOwnKey) return 'byok';
  if (policy.access === 'hosted_free') return 'hosted_free';
  if (policy.access === 'hosted_beta') return 'hosted_beta';
  return 'hosted_beta';
}

function encodeRequestType(requestType, usageKind) {
  const base = String(requestType || 'chat').trim() || 'chat';
  const kind = String(usageKind || '').trim();
  if (!kind) return base;
  if (base.indexOf(':') >= 0) return base;
  return `${base}:${kind}`;
}

function decodeUsageKind(requestType) {
  const raw = String(requestType || '');
  if (raw.indexOf(':') === -1) return 'hosted_beta';
  return raw.split(':').pop() || 'hosted_beta';
}

function getBaseRequestType(requestType) {
  const raw = String(requestType || 'chat');
  return raw.split(':')[0] || 'chat';
}

function getPublicModelCatalog() {
  return PUBLIC_MODEL_ORDER.map((id) => {
    const item = getModelPolicy(id);
    return {
      id: item.id,
      label: item.label,
      provider: item.provider,
      access: item.access,
      badge: item.badge,
      recommended: !!item.recommended,
      short_description: item.short_description,
      best_for: item.best_for,
    };
  });
}

module.exports = {
  MODEL_POLICIES,
  PUBLIC_MODEL_ORDER,
  getModelPolicy,
  isHostedFreeModel,
  isHostedBetaModel,
  isHostedModel,
  isByokModel,
  isDesktopAgentModel,
  getRequiredProviderKey,
  classifyUsageKind,
  encodeRequestType,
  decodeUsageKind,
  getBaseRequestType,
  getPublicModelCatalog,
};
