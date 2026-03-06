const coreToolDefinitions = require('../../tools/tool-schemas.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRequestedNames(names) {
  if (!Array.isArray(names) || names.length === 0) return null;
  return new Set(names.map((name) => String(name || '').trim()).filter(Boolean));
}

function getCoreToolDefinitions(names) {
  const requested = normalizeRequestedNames(names);
  const defs = requested
    ? coreToolDefinitions.filter((tool) => requested.has(tool.name))
    : coreToolDefinitions;
  return clone(defs);
}

function toOpenAIFunctionTool(definition) {
  return {
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description || '',
      parameters: definition.parameters || { type: 'object', properties: {} },
    },
  };
}

function getCoreOpenAITools(names) {
  return getCoreToolDefinitions(names).map(toOpenAIFunctionTool);
}

function getCoreAnthropicTools(names) {
  return getCoreOpenAITools(names).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

module.exports = {
  getCoreToolDefinitions,
  getCoreOpenAITools,
  getCoreAnthropicTools,
};
