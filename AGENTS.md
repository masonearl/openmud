# openmud — Agent / AI Contributor Guide

This file is the source of truth for AI agents, contributors, and automated systems working on this codebase. Read it fully before making changes.

---

## True north — what openmud is actually building

openmud is an open-source agentic AI platform for heavy civil and underground utility construction. The goal is not a chatbot. The goal is AI that takes construction tasks to the finish line — executing real workflows, not just answering questions.

Think of it as the open-source version of what an experienced construction PM or estimator does every day: reads documents, creates bluestakes, writes emails, generates proposals, processes invoices, runs takeoffs, tracks production. openmud is building free, open AI tooling to automate those tasks for the people who do that work.

**The test for any new feature:** Does this save a construction professional real time on a real task? If yes, build it. If it's just informational, deprioritize.

**Live site:** https://openmud.ai
**GitHub:** https://github.com/masonearl/openmud

---

## Agentic architecture — how the system should work

openmud is moving toward a tool-orchestration model. The AI does not just answer — it selects and executes tools from a registered library based on user intent or triggered events.

Two modes of operation (both should be supported):

**1. User-triggered (manual):** User describes a task in chat or selects a workflow. The agent selects the right tool(s), runs them, and returns a completed result — a filled-out document, a formatted email, a bluestakes submission draft, a takeoff sheet.

**2. Event-triggered (autonomous):** An external event (email received, document uploaded, schedule trigger) fires a webhook or function call that kicks off a tool chain without the user having to ask. Example: a new subcontractor invoice lands in email → OCR extracts line items → agent reconciles against the contract → flags discrepancies.

The tool registry lives in `tools/registry.py`. Every tool should be defined there with an OpenAI function-calling schema. The chat handler in `api/chat.js` should be wired to call these tools when the model selects them.

---

## Priority tool library — what to build next

These are the highest-value agentic tools for the heavy civil / underground utility audience. Build in this order:

### Tier 1 — Core workflows (highest impact)
| Tool | What it does | Status |
|---|---|---|
| **OCR + document extraction** | Extract text, tables, and line items from PDFs, plan sheets, invoices, RFIs. Output structured JSON. | Planned |
| **Bluestakes / 811 automation** | Pre-fill a bluestakes ticket from job info (address, scope, pipe types, depth). Support UT/ID/NV/AZ. | Planned — existing app on App Store |
| **Email drafting agent** | Given context (project, subcontractor, issue), draft a professional construction email or RFI response. | Planned |
| **Proposal generator** | From scope of work + unit prices → formatted proposal PDF. Currently partially built in `api/proposal.js`. | Partial |
| **Change order generator** | From description of extra work + labor/equipment/material → formatted CO with markup. | Planned |

### Tier 2 — Estimation and field tools
| Tool | What it does | Status |
|---|---|---|
| **Construction takeoff** | Measure linear footage, area, and volume from plan dimensions. Existing external software available. | External — link on site |
| **Schedule generator** | CPM-style schedule from scope items and crew sizes. Basic version in `api/schedule.js`. | Partial |
| **Production tracker** | Daily LF/CY installed vs budget. Calculates on/off pace and projected finish. | Planned |
| **Prevailing wage lookup** | State, county, trade → correct prevailing wage rate with fringe. | Planned |
| **RFI tracker** | Log, number, and track RFIs with response deadlines. | Planned |

### Tier 3 — Data and mapping
| Tool | What it does | Status |
|---|---|---|
| **Job site mapper** | Embed OpenStreetMap (Leaflet.js) for marking site location, corridor, staging areas. No API key required. | Planned |
| **Utility corridor viewer** | Overlay utility as-built data (GeoJSON/KML) on OSM base map. | Planned |
| **Public dataset connector** | Pull BLS wage data, BLS PPI material prices, state DOT project lists on demand. | Planned |

---

## OpenStreetMap and mapping

OpenStreetMap (openstreetmap.org) is the open-source map of the world — free to use, no API key, no per-tile cost. It can be embedded in any browser page using Leaflet.js (also free, MIT license). For openmud:

- Use OSM as the base map layer for job site planning tools
- No Google Maps API key required, no billing account
- Tile server: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- Leaflet.js CDN: `https://unpkg.com/leaflet/dist/leaflet.js`
- Relevant for: marking job sites, viewing utility corridors, generating coordinates for bluestakes requests, site logistics planning

---

## OCR and document extraction

OCR (optical character recognition) is a core capability for construction AI. Most construction documents come in as PDFs or scanned images. The agent needs to read them.

Recommended open-source approach:
- **Tesseract** — free, open-source OCR engine. Python bindings via `pytesseract`. Good for scanned documents.
- **pdfplumber** — extract text and tables from native PDFs (not scanned). Pure Python, MIT license.
- **pdf2image** — convert PDF pages to images for Tesseract when text layer is absent.
- **OpenCV** — image preprocessing (deskew, denoise) before OCR pass.

Planned pipeline: `PDF upload → pdfplumber (text) → if no text, pdf2image + Tesseract (OCR) → structured extraction via GPT-4o → JSON output`

The extraction output feeds downstream tools: proposal generator, change order tool, RFI tracker, invoice reconciliation.

Add Python dependencies to `tools/requirements.txt` when implementing.

---

## Existing external tools (link on site, consider integrating)

These tools are already built and live. Link them prominently on the site. Consider API integration where possible.

| Tool | Platform | Description | Link |
|---|---|---|---|
| **Swift Stakes** | iOS App Store | Automates 811 bluestakes ticket submission for UT and surrounding states. | https://apps.apple.com/us/app/swift-stakes-blue-stakes-utah/id6737917498 |
| **Construction Takeoff** | macOS App Store | PDF editor and markup tool for plan takeoffs. Measure LF, area, counts directly on plan sheets. | https://apps.apple.com/us/app/construction-takeoff/id6466373898 |
| **Construction Docs Pro** | macOS App Store | Estimates and bid document generator. Proposals, cost tracking, bid packages. | https://apps.apple.com/us/app/construction-docs-pro/id6736613259 |

When integrating the takeoff software: expose its core functions as openmud tool-registry entries so the chat agent can invoke a takeoff calculation during a conversation.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — no framework |
| API | Vercel serverless functions (Node.js, `api/*.js`) |
| AI | OpenAI (GPT-4o, GPT-4o-mini) + Anthropic (Claude) via their REST APIs |
| Tool calling | OpenAI function-calling via `tools/registry.py` schemas |
| Python tools | Pure Python, importable as a library |
| Mapping | Leaflet.js + OpenStreetMap tiles (planned) |
| OCR | Tesseract + pdfplumber (planned) |
| Deployment | Vercel (free tier works) |

---

## Repository layout

```
openmud/
├── api/                  # Vercel serverless API routes
│   ├── chat.js           # Main AI chat — routes to OpenAI or Anthropic, applies system prompt
│   ├── search.js         # Site search with caching, fast path, RAG chunks
│   ├── schedule.js       # Construction schedule generator
│   ├── proposal.js       # Proposal HTML renderer
│   ├── predict.js        # Estimate cost prediction proxy
│   ├── feedback.js       # User feedback collection
│   └── health.js         # Health check endpoint
├── data/
│   └── site-content.json # RAG knowledge base — chunks indexed for search and AI context
├── public/               # Static site pages
│   ├── index.html        # Homepage with search
│   ├── chat.html         # AI chat interface
│   ├── calculators.html  # 18+ browser-based construction calculators
│   ├── resources.html    # Reference library (OSHA, standards, tools, datasets)
│   ├── companies.html    # ESOP and contractor directory
│   ├── innovators.html   # Innovation in heavy civil
│   └── about.html
├── tools/                # Standalone Python tool library
│   ├── estimating/estimating_tools.py
│   ├── schedule/schedule_tools.py
│   ├── proposal/proposal_tools.py
│   ├── registry.py       # OpenAI function-calling schemas — all tools defined here
│   └── __init__.py
├── docs/
│   ├── API.md
│   └── ROADMAP.md
├── AGENTS.md             # This file — true north for all contributors and AI agents
└── vercel.json
```

---

## RAG knowledge base

`data/site-content.json` is the retrieval database for the site search and AI chat context. It contains chunks of domain knowledge about heavy civil construction — OSHA, pipe specs, hydraulics, tools, glossary, companies, and more.

When adding new domain knowledge:
- Add a chunk with a unique `id`, a `category`, a `title`, `content` (plain prose, ~150-400 words), a `url` pointing to the relevant page, and `tags` (array of search-relevant terms)
- Content should be factual and useful on its own — not marketing copy
- Categories in use: Safety, Calculator, Reference, Tools, Resources, Companies, Industry, Glossary, About, Navigation

---

## Key files to know

### `api/chat.js`
- `SYSTEM_PROMPTS.mud1` is the core AI persona — direct, technical, built for field use
- Add new tool schemas to the messages array when wiring tool calling
- Target: wire `tools/registry.py` schemas so the AI executes tools during chat

### `api/search.js`
- In-memory cache (15min TTL, 500 entries), fast path for high-confidence queries, 7s OpenAI timeout
- `getSentences()` handles decimal numbers correctly (null-byte placeholder trick)
- Feeds top-ranked chunks as context to GPT-4o-mini for AI-synthesized answers

### `tools/registry.py`
- All tools should be defined here with OpenAI function-calling schema
- This is where the agentic tool library lives

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | One of these | OpenAI API access |
| `ANTHROPIC_API_KEY` | One of these | Anthropic Claude access |
| `CONTECH_API_URL` | Optional | Override for predict/feedback proxy |

---

## Coding conventions

- **JavaScript**: No frameworks, no build step. Vanilla JS only. No new npm dependencies without a strong reason.
- **Python**: PEP 8, type hints where practical, clear docstrings. Tools should be pure functions.
- **No filler comments** — comments explain intent and trade-offs, not what the code does.
- **One PR per thing** — focused, reviewable changes.

## UI and content rules

- **No emojis** anywhere on the site unless explicitly requested for a specific instance.
- **No decorative Unicode** — no ★, ☆, ✓, or similar as UI elements. Use plain text or CSS.
- **Tone**: Direct, technical, no fluff. Written for people who work in the field.
- **No marketing copy** in the knowledge base or UI — say what the thing does, not how great it is.

---

## What needs the most help (priority order)

1. **Wire tool calling in `api/chat.js`** — the tool registry exists, the AI needs to actually call tools during chat. This is the single highest-leverage change.
2. **OCR pipeline** — `pdfplumber` + Tesseract + GPT-4o extraction. Unlocks document-based workflows.
3. **Bluestakes agent** — pre-fill 811 tickets from job info. High frequency task for utility contractors.
4. **Email drafting agent** — construction-specific email/RFI drafts from context.
5. **Job site mapper** — Leaflet.js + OSM embedded in the browser. No API key, zero cost.
6. **Better unit rates** — `tools/estimating/estimating_tools.py` rates are ballpark. Real regional data welcome.
7. **Change order generator** — complete the partial proposal workflow for COs.
