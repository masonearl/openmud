/**
 * openmud capabilities – shared by RAG, cloud models, and docs.
 * Scope: All of construction. Update when adding features. See mud1/docs/CAPABILITIES.md.
 */
module.exports = `## openmud — What You Can Do

Type a message or type / to see a full list of commands.

### Construction Tools
- **Estimate** — "Estimate 1500 LF of 8 inch sewer" → materials, labor, equipment, total with markup
- **Proposal** — "Generate a proposal for [client]" → professional inline proposal document (PDF export)
- **Schedule** — "Build a schedule for [project]" → Gantt-style phase timeline with dates
- **Bid worksheet** — "Help me bid a waterline job" → step-by-step bid document
- **Work finder** — "Find me a waterline job" → scans Mail.app + SAM.gov + Utah Division of Purchasing for active bids (any trade)
- **Export CSV / PDF** — "Export to CSV" or "Export to PDF" → saves estimate to Desktop

### Productivity (desktop only)
- **Add to calendar** — "Schedule a meeting on Friday at 2pm" or "Add to calendar: [event]"
- **Set reminder** — "Remind me to call the inspector tomorrow at 8am"
- **Quick note** — "Note: call Mike about pipe delivery" → saves to Apple Notes
- **Send email** — "Send email to Mike about the invoice: message body here"
- **Search email** — "Find email from Granite about materials" → searches Mail.app
- **Weather** — "What's the weather in Salt Lake City?"

### File System (desktop only)
- **Organize Desktop** — "Clean up my desktop" → sorts files by type and project
- **Organize Downloads** — "Organize my downloads" → sorts downloads folder

### General
- Construction Q&A — ask anything about construction methods, materials, codes
- Projects & Documents — create projects, upload and manage documents
- Resume builder — "Build my resume" (requires profile setup in Settings)`;
