# Rockmud

**Open-source AI for construction — estimate, schedule, and build proposals on solid ground.**

Site: [rockmud.com](https://rockmud.com)

Rockmud is a free, open-source AI assistant built for underground utility and heavy civil construction. It understands trenching, pipe sizing, labor and equipment rates, and the bid workflows contractors actually use.

---

## What it does

- **AI chat** — Ask about costs, specs, scheduling, scope, or any construction question. Uses OpenAI and Anthropic models.
- **Quick estimate** — Get material, labor, and equipment cost breakdowns for common underground work.
- **Schedule generator** — Build a phased construction schedule and download it as a PDF.
- **Proposal generator** — Generate a formatted proposal from your estimate in one click.

---

## Project structure

```
rockmud.com/
├── api/                    # Serverless API functions (Vercel)
│   ├── chat.js             # Chat: OpenAI + Anthropic, tool routing
│   ├── predict.js          # Estimate proxy (configurable via CONTECH_API_URL)
│   ├── feedback.js         # Feedback proxy (configurable via CONTECH_API_URL)
│   ├── schedule.js         # Schedule generation + HTML output
│   ├── proposal.js         # Proposal generation + HTML output
│   └── health.js           # Health check
├── assets/
│   ├── css/styles.css
│   └── js/app.js
├── config/
│   └── env.example         # Copy to .env.local, add your API keys
├── docs/
│   ├── API.md              # API contract and model routing
│   └── ROADMAP.md          # What's being built next
├── tools/                  # Python tools (estimating, scheduling, proposals)
│   ├── estimating/
│   ├── schedule/
│   ├── proposal/
│   ├── registry.py         # OpenAI-compatible tool schemas
│   └── README.md
├── index.html
├── about.html
├── documentation.html
└── vercel.json
```

---

## Local development

```bash
# Install dependencies
npm install

# Run with Vercel dev (includes API routes)
vercel dev
```

Or serve the frontend only (no API):

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

**Environment variables** — copy `config/env.example` to `.env.local` and add your keys:

```bash
cp config/env.example .env.local
# Edit .env.local and add OPENAI_API_KEY and/or ANTHROPIC_API_KEY
```

---

## Deploy your own

1. Fork this repo
2. Connect to [Vercel](https://vercel.com)
3. Add `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in Vercel → Project → Settings → Environment Variables
4. Deploy — that's it

---

## Contributing

Rockmud is built for construction people by construction people. Contributions welcome — new tools, better pricing data, additional workflows, bug fixes.

Open an issue or submit a PR. See [docs/ROADMAP.md](docs/ROADMAP.md) for what's coming next.

---

## License

MIT
