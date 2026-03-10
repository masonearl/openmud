# openmud API Notes

This document covers the current serverless API under `web/api`.
It focuses on the routes that drive chat, model access policy, usage limits, desktop updates, and project/chat sync.

## Runtime and config

- Deploy target: Vercel serverless functions in `web/api`.
- Local env template: `web/.env.example`.
- Required for chat: at least one of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
- Required for authenticated usage tracking and dashboards: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Core chat route

`POST /api/chat`

### Request body

```json
{
  "messages": [{ "role": "user|assistant|system", "content": "..." }],
  "model": "mud1",
  "temperature": 0.7,
  "max_tokens": 1024,
  "use_tools": false,
  "estimate_context": null,
  "stream": false,
  "project_id": "optional-project-id"
}
```

### Provider override headers (BYOK)

- `X-OpenAI-Api-Key`
- `X-Anthropic-Api-Key`
- `X-Grok-Api-Key`
- `X-OpenRouter-Api-Key`
- `X-OpenClaw-Api-Key`
- `X-OpenClaw-Base-Url`
- `X-OpenClaw-Model`
- `X-Openmud-Relay-Token`
- `X-Client-Date` (calendar intent timezone helper)

### Auth and model policy

Policy is enforced in `web/api/chat.js` + `web/api/lib/model-policy.js`:

1. `mud1` is hosted and free (`hosted_free`).
2. Hosted beta models are platform-hosted with daily caps (`hosted_beta`).
3. Premium/non-hosted models require BYOK (`byok`).
4. Desktop agent model (`openclaw`) is treated as `desktop_agent`.

Auth behavior:

1. Hosted requests require authenticated user context.
2. BYOK requests can run without sign-in.
3. Hosted beta requests allocate usage before model execution.

### Response shape

Base response:

```json
{
  "response": "Assistant text",
  "tools_used": []
}
```

Optional fields returned for specific flows:

- `rag`: mud1 retrieval metadata (`confidence`, `fallback_used`, `sources`).
- `_proposal_html`: proposal/document generation HTML payload.
- `_choices`: disambiguation choices (for relay contact ambiguity).

### Important behavior

- `mud1` path runs RAG with optional project context merge.
- `stream=true` is only supported when `use_tools=false`.
- Relay token path can execute email/calendar/iMessage workflows through local agent relay.
- Usage events are logged when user context is present.

## Related platform routes

### `GET /api/platform`

Returns public platform policy and model catalog:

- `default_model`
- `tier_limits`
- policy notes (`mud1 free`, hosted beta limits, BYOK support)
- `models` with `access` classification

### `GET|POST /api/usage`

- `GET`: current daily usage (`used`, `limit`, `tier`, `date`)
- `POST`: allocate usage (unless `increment=false`) and optionally log usage event

### `GET /api/dashboard?days=30`

Per-user analytics from `usage_events`:

- totals
- daily breakdown
- by model/source/usage kind
- recent events

Returns `needs_setup: true` when usage tables are missing.

## Agentic step route (desktop/tool loop)

`POST /api/agentic-step`

- Requires authenticated user.
- Allocates usage using the same limit path as chat.
- Calls Anthropic with a fixed agentic tool set for one step.
- Returns `{ stop_reason, text, tool_calls, content, usage }`.

## Project and message sync routes

- `GET|POST|PUT /api/projects`
- `GET|POST|PUT /api/chat-messages`

Both require authenticated user and Supabase service role access.
Both enforce project ownership (`user_id`) before read/write.

## Desktop delivery routes

- `GET /api/desktop-version`: latest desktop version metadata for updater.
- `GET /api/download-desktop`: redirect to latest zip (or dmg fallback).
- `GET /api/download-dmg`: dmg download endpoint (supports proxy streaming with `GITHUB_TOKEN`).

## Setup runbook: usage tables

If dashboard or usage APIs indicate setup is missing:

1. Open Supabase SQL editor for the project.
2. Run `web/api/lib/migrations/003_combined_setup.sql`.
3. Re-test `GET /api/dashboard`.

## Common pitfalls

1. `401` on `/api/chat`: hosted request without auth session.
2. `403` on `/api/chat`: model requires BYOK key, but no provider key header was supplied.
3. `429` on `/api/chat`: hosted beta daily cap reached.
4. `needs_setup: true` on dashboard: usage migrations not applied.
5. Relay automation failures with `openclaw`: missing/invalid `X-Openmud-Relay-Token` or no connected Mac agent.
