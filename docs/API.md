# openmud Web API Contract

This document covers the current `web/api` interfaces used by the web app for chat workflows, project state, and document generation.

## Scope

- Primary orchestration: `POST /api/chat`
- Durable project state: `GET|PUT|DELETE /api/project-data`
- Project document retrieval index: `POST /api/rag-index`, `POST /api/rag-search`
- Deterministic builders: `POST /api/proposal`, `POST /api/schedule`, `POST /api/change-order`

## Auth and Provider Keys

- Hosted chat requests require a signed-in user.
- BYOK chat requests can run without sign-in when provider key headers are supplied.
- `project-data`, `rag-index`, and `rag-search` always require a signed-in user and project ownership.
- Do not embed provider keys in messages. Use headers or server environment variables.

### Provider key headers for `POST /api/chat`

- `X-OpenAI-Api-Key`
- `X-Anthropic-Api-Key`
- `X-Grok-Api-Key`
- `X-OpenRouter-Api-Key`
- `X-OpenClaw-Api-Key`

### Environment variables used by these paths

- `OPENAI_API_KEY` for hosted OpenAI paths and workflow extraction
- `ANTHROPIC_API_KEY` for hosted Claude paths
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for project ownership checks and project data APIs

## `POST /api/chat`

Main chat endpoint with workflow routing and model dispatch.

### Request body

```json
{
  "messages": [
    { "role": "user", "content": "Create a change order for extra rock excavation." }
  ],
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "max_tokens": 1024,
  "use_tools": true,
  "project_id": "proj_123",
  "project_name": "Provo Sewer Improvements",
  "project_data": {
    "client_name": "City of Provo",
    "utility_type": "sewer"
  },
  "file_reference_context": {
    "active_file_ids": ["doc_abc"]
  }
}
```

### Workflow V1 routing (when `use_tools: true`)

If user intent matches these workflows and `OPENAI_API_KEY` is configured, chat performs structured extraction + deterministic document generation:

| Workflow | Trigger intent (summary) | `tools_used` entries | Structured block |
|---|---|---|---|
| Proposal | generate/create proposal, quote, scope document | `extract_project_facts` (optional), `generate_proposal` | `[MUDRAG_PROPOSAL]...[/MUDRAG_PROPOSAL]` |
| Schedule | generate/create schedule, timeline, sequencing | `extract_project_facts` (optional), `generate_schedule` | `[MUDRAG_SCHEDULE]...[/MUDRAG_SCHEDULE]` |
| Change order | generate/create change order, extra work | `extract_project_facts` (optional), `generate_change_order` | `[MUDRAG_CHANGE_ORDER]...[/MUDRAG_CHANGE_ORDER]` |
| Project facts only | extract/summarize/save project facts | `extract_project_facts` | `[MUDRAG_PROJECT_FACTS]...[/MUDRAG_PROJECT_FACTS]` |
| Builder plan | builder plan / implementation plan intent | `generate_builder_plan` | `[MUDRAG_BUILDER_PLAN]...[/MUDRAG_BUILDER_PLAN]` |
| Builder validate | validation / ship check intent | `generate_builder_validate` | `[MUDRAG_BUILDER_VALIDATE]...[/MUDRAG_BUILDER_VALIDATE]` |

### Workflow data sources

- Saved state from `project_data` request field.
- Project retrieval context if `project_id` is provided and project ownership is valid.
- Project facts extraction runs automatically for doc workflows only when reusable facts are missing and project retrieval context is available.

### Response shape

```json
{
  "response": "Proposal ready for City of Provo.\n\n[MUDRAG_PROJECT_FACTS]{...}[/MUDRAG_PROJECT_FACTS]\n\n[MUDRAG_PROPOSAL]{...}[/MUDRAG_PROPOSAL]",
  "tools_used": ["extract_project_facts", "generate_proposal"],
  "_proposal_html": "<div class=\"pdf-doc pdf-doc-proposal\">...</div>"
}
```

Possible additional fields:

- `_proposal_html` for proposal workflow
- `_document_html`, `_document_label`, `_document_filename_base` for change orders
- `rag` object for `mud1` RAG responses

### Constraints and normalization details

- Schedule duration is clamped to `1..365`.
- Schedule phases are capped at 12.
- Missing pricing in extracted proposal/change-order payloads is normalized to `0`.
- Project facts metadata contains:
  - `project_facts_meta.confidence` as `high|medium|low`
  - `project_facts_meta.missing_fields` as normalized lowercase field names
  - `project_facts_evidence` snippets (when present)

### Failure mode

If workflow extraction/build fails, chat logs a warning and falls back to normal model chat response. Do not assume structured tags are always present.

## Structured block contract

The web client strips these tags from display text and parses JSON payloads:

- `[MUDRAG_PROJECT_FACTS]...[/MUDRAG_PROJECT_FACTS]`
- `[MUDRAG_PROPOSAL]...[/MUDRAG_PROPOSAL]`
- `[MUDRAG_SCHEDULE]...[/MUDRAG_SCHEDULE]`
- `[MUDRAG_CHANGE_ORDER]...[/MUDRAG_CHANGE_ORDER]`
- `[MUDRAG_BUILDER_PLAN]...[/MUDRAG_BUILDER_PLAN]`
- `[MUDRAG_BUILDER_VALIDATE]...[/MUDRAG_BUILDER_VALIDATE]`

If you are writing another client, follow the same parse-then-strip pattern.

## `GET|PUT|DELETE /api/project-data`

Durable per-project state keyed by `project_id` and `user_id`.

### `GET /api/project-data?project_id=<id>`

Returns:

```json
{
  "project_id": "proj_123",
  "project_data": { "scope_summary": "Install 1,200 LF of sewer main." },
  "updated_at": "2026-03-10T18:05:12.000Z"
}
```

### `PUT /api/project-data`

Request:

```json
{
  "project_id": "proj_123",
  "project_data": {
    "utility_type": "sewer",
    "project_risks": ["Traffic control restrictions"]
  }
}
```

Important: `PUT` replaces stored `project_data` with the incoming object. Merge on the client before writing if you need partial updates.

### `DELETE /api/project-data?project_id=<id>`

Deletes the durable state row for that project/user.

## Project document retrieval APIs

### `POST /api/rag-index`

Indexes document text for project retrieval:

```json
{
  "project_id": "proj_123",
  "document_id": "doc_456",
  "title": "Bid Package Addendum 2",
  "source": "upload",
  "source_meta": { "filename": "addendum-2.pdf" },
  "text": "Full extracted text..."
}
```

### `POST /api/rag-search`

Queries indexed chunks:

```json
{
  "project_id": "proj_123",
  "query": "rock excavation allowance",
  "top_k": 5
}
```

Returns ranked snippets, confidence, and fallback metadata.

## Deterministic builder endpoints

These endpoints generate HTML documents directly from structured inputs:

- `POST /api/proposal`
- `POST /api/schedule`
- `POST /api/change-order`

Each returns normalized structured fields plus an `html` string for rendering/export.

## Workflow Runbook (Web Client)

1. Load project and cached `project_data`.
2. Send chat with `use_tools: true`, `project_id`, `project_name`, and current `project_data`.
3. Parse structured tags from `response`.
4. Merge and persist project facts to `PUT /api/project-data`.
5. Render `_proposal_html` or `_document_html` previews when present.
6. Handle fallback gracefully if no workflow tags are returned.

## Troubleshooting

- `401 Sign in to chat`: hosted model request without auth and without BYOK header.
- `403 model requires your own key`: requested model is BYOK-only and no matching key header provided.
- `429 hosted beta limit reached`: hosted beta quota exhausted for user.
- No workflow output tags:
  - verify `use_tools: true`
  - verify intent clearly asks for proposal/schedule/change order/project facts
  - verify `OPENAI_API_KEY` exists on server
  - check if chat fell back to normal response
- `project-data` updates unexpectedly missing fields:
  - expected if client wrote a partial object via `PUT`
  - merge existing state client-side before saving
