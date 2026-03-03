# openmud Capabilities – Single Source of Truth

**Scope: All of construction.** openmud is an AI assistant for the full construction industry—residential, commercial, civil, underground utility, and more.

**Update this file when you add new features.** Then update:
- `mud1/data/construction-qa.json` – add RAG Q&A for new features
- `mud1/prompts/capabilities.js` – sync the capabilities block (used by cloud models)

---

## What openmud Can Do

### Tools (Desktop + Web)
- **Quick estimate** – Material, labor, equipment costs. Pipe (4/6/8 inch), concrete, rebar. LF, soil type, crew size.
- **Proposal** – Generate bid documents from estimates. Client, scope, total, bid items. Export PDF.
- **Schedule** – Gantt-style project schedule. Phases, duration, start date. Export PDF.
- **Projects** – Create and manage projects. Sidebar lists your projects.
- **Documents** – Upload docs to projects (desktop).
- **Clean Desktop / Clean Downloads** – Organize files by type, create project folders (desktop only).
- **Email search** – "Find the email from Granite about material pricing." Searches Mail.app, opens results in Mail (desktop only). Requires Mail.app with accounts configured. See openmud.ai/mail-search-setup.html.

### Chat
- Construction Q&A – pipe cost, labor rates, bedding, soil, bidding, etc.
- Estimate in chat – "Estimate 500 LF of 8 inch sewer in clay"
- Generate schedule – "Create a schedule for X, 14 days, phases: mobilize, trench, lay pipe..."
- Generate proposal – "Generate a proposal from that estimate"

### Coming Soon
- Project history / search – "What did we bid last week?"
- RAG over your documents
- More tools as we build

---

## Short "What Can You Do" Response

I can help with: cost estimates (waterline, sewer, storm, gas), proposals, project schedules, and construction questions. Use the Tools menu for Quick estimate, Proposal, or Schedule—or ask in chat. Desktop: I can also organize your desktop or downloads.
