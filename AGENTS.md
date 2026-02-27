# openmud — Agent / AI Contributor Guide

This file helps AI assistants (Cursor, Copilot, Claude, etc.) understand the codebase quickly so they can give accurate help.

---

## What this project is

openmud is an open-source AI assistant for heavy civil and underground utility construction. It runs on Vercel as a static frontend + serverless API backend. The Python `tools/` library is standalone and can be used independently.

**Live site:** https://openmud.ai  
**GitHub:** https://github.com/masonearl/openmud

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — no framework |
| API | Vercel serverless functions (Node.js, `api/*.js`) |
| AI | OpenAI (GPT-4o, GPT-4o-mini) + Anthropic (Claude) via their REST APIs |
| Python tools | Pure Python, no web framework, importable as a library |
| Deployment | Vercel (free tier works) |

---

## Repository layout

```
openmud/
├── api/                  # Vercel serverless API routes
│   ├── chat.js           # Main AI chat — routes to OpenAI or Anthropic, applies system prompt
│   ├── schedule.js       # Construction schedule generator
│   ├── proposal.js       # Proposal HTML renderer
│   ├── predict.js        # Estimate cost prediction proxy
│   ├── feedback.js       # User feedback collection
│   └── health.js         # Health check endpoint
├── assets/
│   ├── css/styles.css    # All app styles
│   └── js/app.js         # All frontend logic (chat, estimate form, modals, PDF export)
├── config/
│   └── env.example       # Copy to .env.local for local dev
├── docs/
│   ├── API.md            # API endpoint reference
│   └── ROADMAP.md        # Planned features
├── tools/                # Standalone Python estimating library
│   ├── estimating/
│   │   └── estimating_tools.py   # calculate_material_cost, calculate_labor_cost, estimate_project_cost
│   ├── schedule/
│   │   └── schedule_tools.py     # build_schedule
│   ├── proposal/
│   │   └── proposal_tools.py     # render_proposal_html
│   ├── registry.py       # OpenAI function-calling tool schemas for all tools
│   ├── requirements.txt
│   └── __init__.py       # Re-exports all tools for easy import
├── index.html            # Main single-page app
├── about.html
├── documentation.html
├── package.json          # Just for vercel dev dependency
└── vercel.json           # Routing: /api/* → serverless, everything else → static
```

---

## Key files to know

### `api/chat.js`
- Handles `/api/chat` POST requests
- `SYSTEM_PROMPTS` object at the top — this is where the AI persona lives. `mud1` is the default heavy civil persona.
- Routes to OpenAI or Anthropic based on the `model` field in the request body
- Reads `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from environment

### `assets/js/app.js`
- All frontend JavaScript — no bundler, plain ES modules loaded via `<script type="module">`
- Handles chat UI, estimate form, PDF generation (via html2pdf), model selection
- Communicates with `/api/chat`, `/api/schedule`, `/api/proposal`

### `tools/estimating/estimating_tools.py`
- Hardcoded unit rates (this is what the community should improve with real-world data)
- `MATERIAL_RATES`, `LABOR_RATES`, `EQUIPMENT_RATES` dicts at the top of the file
- Functions: `calculate_material_cost()`, `calculate_labor_cost()`, `calculate_equipment_cost()`, `estimate_project_cost()`

### `tools/registry.py`
- OpenAI function-calling schema for all tools
- When wiring real tool calling to the chat API, import from here

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | One of these | OpenAI API access |
| `ANTHROPIC_API_KEY` | One of these | Anthropic Claude access |
| `CONTECH_API_URL` | Optional | Override for the predict/feedback proxy (defaults to openmud.ai) |

Copy `config/env.example` to `.env.local` for local dev. Never commit real keys.

---

## Local development

```bash
# Full app with API
npm install
cp config/env.example .env.local
# Fill in your API key(s)
vercel dev   # → http://localhost:3000

# Python tools only
pip install -r tools/requirements.txt
python3 -c "from tools import calculate_material_cost; print(calculate_material_cost('pipe', 500, '8'))"
```

---

## Coding conventions

- **JavaScript**: No frameworks, no build step. Keep it simple vanilla JS. Avoid adding dependencies.
- **Python**: PEP 8, type hints where practical, clear docstrings. Tools should be pure functions.
- **No AI-generated filler comments** — comments explain intent, not what the code does.
- **One PR per thing** — focused, reviewable changes.

## UI & Content rules

- **No emojis** — do not use emoji characters anywhere on the site (HTML, CSS content, JS strings, or AI-generated copy) unless the user explicitly requests them in that specific instance.
- **No decorative Unicode symbols** — avoid ★, ☆, ✓, ⌁, ◻, ⬡, and similar decorative characters as UI elements. Use plain text, dashes, or CSS pseudo-elements instead.
- **Tone**: Direct, technical, no fluff. Written for people who work in the field, not marketing copy.

---

## What needs the most help

1. **Better unit rates** — `tools/estimating/estimating_tools.py` rates are ballpark. Regional data, union vs open shop, current market pricing all welcome.
2. **Real tool calling** — wire `tools/registry.py` schemas into `api/chat.js` so the AI actually calls the Python tools during chat.
3. **New tools** — change order generator, RFI tracker, takeoff calculator, invoice generator.
4. **AI prompts** — `SYSTEM_PROMPTS` in `api/chat.js` — better prompts for specific trade work.
5. **Mobile UI** — `assets/css/styles.css` — the app is desktop-first, needs mobile love.
