# openmud Chat API Contract

The frontend calls `POST /chat` on the Contech API. Backend should support:

## Where to put API keys

**Never put API keys in the chat or in the frontend.** They would be exposed in logs, browser dev tools, and chat history.

Put keys in your **openmud Vercel project** (the `/api` serverless functions use them):

1. **Vercel** – Project → Settings → Environment Variables
2. **Local** – Copy `config/env.example` to `.env` (add `.env` to `.gitignore`)

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

The frontend never sees or sends keys—it only sends the model name. The backend picks the key based on the model.

## Request body

```json
{
  "messages": [{"role": "user|assistant", "content": "..."}],
  "model": "gpt-4o-mini|mud1|claude-3-5-haiku-20241022|...",
  "temperature": 0.7,
  "max_tokens": 512,
  "use_tools": true,
  "available_tools": ["build_schedule", "render_proposal_html", "estimate_project_cost", ...]
}
```

## Model routing

- **mud1** – openmud custom model (in development)
- **gpt-*** – OpenAI API (OPENAI_API_KEY)
- **claude-*** – Anthropic API (ANTHROPIC_API_KEY)

## Tool calling

When `use_tools: true`, OpenAI and Anthropic models run tool-calling with:

1. Enable function/tool calling for the selected model
2. Load schemas from `tools/registry.py` through `GET /api/python/registry`
3. Execute estimating tools through `POST /api/python/tools`
4. Return the tool result in the response

## Response

```json
{
  "response": "Assistant message text",
  "tools_used": ["build_schedule", "estimate_project_cost"]
}
```

## Python tool executor

`POST /api/python/tools`

```json
{
  "tool_name": "calculate_labor_cost",
  "arguments": {
    "labor_type": "operator",
    "hours": 40,
    "region": "utah"
  }
}
```

## Tool registry endpoint

`GET /api/python/registry`

Returns OpenAI-compatible function schemas from `tools/registry.py`.

## Tool telemetry endpoint

`GET /api/tool-metrics`

Returns in-memory metrics for:
- tool success/error rate
- fallback rate when tools were enabled
- tool latency and recent errors
