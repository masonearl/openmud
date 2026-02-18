# Rockmud Chat API Contract

The frontend calls `POST /chat` on the Contech API. Backend should support:

## Where to put API keys

**Never put API keys in the chat or in the frontend.** They would be exposed in logs, browser dev tools, and chat history.

Put keys in your **backend** (the server that hosts `masonearl.com/api/contech`):

1. **If using Vercel** – Project → Settings → Environment Variables
2. **If using a Node/Python server** – `.env` file in the backend repo (add `.env` to `.gitignore`)

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
  "available_tools": ["build_schedule", "generate_proposal", "estimate_project_cost", ...]
}
```

## Model routing

- **mud1** – Rockmud custom model (in development)
- **gpt-*** – OpenAI API (OPENAI_API_KEY)
- **claude-*** – Anthropic API (ANTHROPIC_API_KEY)

## Tool calling

When `use_tools: true`, the backend should:

1. Enable function/tool calling for the selected model
2. Use schemas from `tools/registry.py` for build_schedule, generate_proposal, estimate_project_cost, etc.
3. Execute Python tools when the model requests them
4. Return the tool result in the response

## Response

```json
{
  "response": "Assistant message text",
  "tools_used": ["build_schedule"]
}
```
