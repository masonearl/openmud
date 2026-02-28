# openmud Roadmap

The goal is an open-source agentic AI platform for heavy civil and underground utility construction. AI that takes tasks to the finish line — not just answers questions.

---

## Phase 1 — Tool calling and agent foundation (current)

Wire the existing tool registry into the chat interface so the AI actually executes tools, not just talks about them.

- [ ] Wire `tools/registry.py` schemas into `api/chat.js` (OpenAI function calling)
- [ ] Multi-turn tool execution in chat — model calls tool, gets result, continues reasoning
- [ ] User-configurable rates — let users upload their labor/equipment/material codebook
- [ ] Proposal generator — complete and polish `api/proposal.js` to production quality
- [ ] Change order generator — scope description + rates → formatted CO with markup
- [ ] Invoice generator — time and materials → formatted invoice

## Phase 2 — Document intelligence (OCR + extraction)

Most construction data lives in PDFs and scanned images. The agent needs to read them.

- [ ] PDF text extraction — `pdfplumber` for native PDFs
- [ ] OCR pipeline — `pdf2image` + Tesseract for scanned documents, OpenCV for preprocessing
- [ ] Structured extraction — GPT-4o reads OCR output, returns JSON (line items, dates, amounts, quantities)
- [ ] Plan sheet parser — extract stationing, elevations, pipe sizes from civil plan sheets
- [ ] Invoice reconciler — compare extracted invoice line items against contract/PO
- [ ] RFI tracker — log, number, track RFIs with response deadlines and status

## Phase 3 — Automated workflows (event-triggered agents)

Agents that run when something happens, not just when the user asks.

- [ ] Email intake agent — new email arrives → agent reads it, classifies it (RFI, invoice, subcontract, owner), drafts a response or routes it
- [ ] Bluestakes automation — job info (address, scope, pipe types) → pre-filled 811 ticket → submission draft. Integrate with existing iOS app.
- [ ] Document creation pipeline — scope of work → proposal → schedule → submission package, all in one agent chain
- [ ] Webhook triggers — connect to Gmail/Outlook, Dropbox, or a file share. Agent fires when new docs land.

## Phase 4 — Mapping and field tools

Browser-based tools that work on a phone on a job site.

- [ ] Job site mapper — Leaflet.js + OpenStreetMap tiles. Mark site location, corridor, staging areas. Export coordinates.
- [ ] Utility corridor viewer — overlay GeoJSON/KML as-built data on OSM base map
- [ ] Production tracker — daily LF/CY installed vs budget, on/off pace, projected finish
- [ ] Bore pit sizing calculator — HDD/jack-and-bore pit dimensions by pipe size and bore length
- [ ] Hydrostatic test calculator — test pressure and duration by pipe diameter and class

## Phase 5 — Integrations and ecosystem

- [ ] Takeoff software integration — expose takeoff functions as tool-registry entries callable from chat
- [ ] Public dataset connectors — BLS wages, BLS PPI material prices, state DOT project lists, pulled on demand
- [ ] Notion integration — sync project data, rates codebooks, push estimates/proposals
- [ ] Prevailing wage lookup — state, county, trade → correct rate with fringe
- [ ] OpenStreetMap data layer — query OSM for utility, road, and parcel data near a job address

## Phase 6 — Native / mobile

- [ ] Mobile-first PWA optimization (currently desktop-first)
- [ ] Native iOS/Android after web is proven
- [ ] Offline mode for field use (service worker + cached data)

---

## What is not the focus

- Calculators — 18 exist, they work, they are not the differentiator. Build agents instead.
- Generic AI chat — mud1 is good enough. Make it do things, not just talk.
- BIM / IFC / architectural tools — not the audience. Heavy civil and underground utility only.
- Paid features — everything on openmud.ai stays free and open source. MIT license.

---

*Last updated: Feb 2026*
