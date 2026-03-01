const state = {
  started_at: new Date().toISOString(),
  totals: {
    chat_runs: 0,
    chat_runs_tools_enabled: 0,
    chat_runs_with_tool_calls: 0,
    chat_runs_with_tool_errors: 0,
    chat_runs_fallback_without_tools: 0,
    tool_invocations: 0,
    tool_invocations_success: 0,
    tool_invocations_error: 0,
  },
  by_provider: {},
  by_model: {},
  by_tool: {},
  recent_errors: [],
};

function bump(map, key, delta = 1) {
  map[key] = (map[key] || 0) + delta;
}

function recordChatRun(event) {
  const e = event || {};
  state.totals.chat_runs += 1;
  if (e.tools_enabled) state.totals.chat_runs_tools_enabled += 1;
  if ((e.tool_calls || 0) > 0) state.totals.chat_runs_with_tool_calls += 1;
  if ((e.tool_errors || 0) > 0) state.totals.chat_runs_with_tool_errors += 1;
  if (e.fallback_without_tools) state.totals.chat_runs_fallback_without_tools += 1;

  if (e.provider) bump(state.by_provider, e.provider, 1);
  if (e.model) bump(state.by_model, e.model, 1);
}

function recordToolInvocation(event) {
  const e = event || {};
  state.totals.tool_invocations += 1;

  if (e.success) state.totals.tool_invocations_success += 1;
  else state.totals.tool_invocations_error += 1;

  if (e.tool_name) {
    if (!state.by_tool[e.tool_name]) {
      state.by_tool[e.tool_name] = {
        calls: 0,
        success: 0,
        error: 0,
        total_latency_ms: 0,
      };
    }
    const t = state.by_tool[e.tool_name];
    t.calls += 1;
    if (e.success) t.success += 1;
    else t.error += 1;
    t.total_latency_ms += Number(e.latency_ms || 0);
  }

  if (!e.success && e.error) {
    state.recent_errors.push({
      at: new Date().toISOString(),
      provider: e.provider || null,
      model: e.model || null,
      tool_name: e.tool_name || null,
      error: String(e.error).slice(0, 500),
    });
    if (state.recent_errors.length > 25) {
      state.recent_errors = state.recent_errors.slice(-25);
    }
  }
}

function snapshot() {
  const byToolWithRates = Object.fromEntries(
    Object.entries(state.by_tool).map(([name, t]) => {
      const avgLatency = t.calls > 0 ? Number((t.total_latency_ms / t.calls).toFixed(1)) : 0;
      const errorRate = t.calls > 0 ? Number((t.error / t.calls).toFixed(4)) : 0;
      return [name, { ...t, avg_latency_ms: avgLatency, error_rate: errorRate }];
    })
  );

  const successRate = state.totals.tool_invocations > 0
    ? Number((state.totals.tool_invocations_success / state.totals.tool_invocations).toFixed(4))
    : 0;

  return {
    started_at: state.started_at,
    generated_at: new Date().toISOString(),
    totals: {
      ...state.totals,
      tool_success_rate: successRate,
    },
    by_provider: state.by_provider,
    by_model: state.by_model,
    by_tool: byToolWithRates,
    recent_errors: state.recent_errors,
  };
}

module.exports = {
  recordChatRun,
  recordToolInvocation,
  snapshot,
};
