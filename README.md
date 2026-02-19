# Rockmud

AI for construction. Plan, estimate, and run jobs on solid ground.

**Site:** [rockmud.com](https://rockmud.com)

## Project structure

```
rockmud.com/
├── api/                    # Serverless API (Vercel)
│   ├── chat.js             # Chat with OpenAI/Anthropic
│   ├── predict.js          # Estimate proxy → masonearl
│   ├── feedback.js         # Feedback proxy → masonearl
│   └── health.js           # Health check
├── assets/                 # Frontend assets
│   ├── css/
│   │   └── styles.css
│   └── js/
│       └── app.js
├── config/                 # Configuration templates
│   └── env.example
├── docs/                   # Documentation
│   ├── API.md
│   ├── DNS-SETUP.md
│   └── DNS-SQUARESPACE.md
├── tools/                  # Python backend tools
│   ├── estimating_tools.py
│   ├── schedule_tools.py
│   ├── proposal_tools.py
│   ├── registry.py
│   └── README.md
├── index.html              # App
├── about.html
├── documentation.html
├── package.json
├── vercel.json
└── README.md
```

## Local dev

```bash
npm install
vercel dev
```

Or static only:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000

## Deploy

Push to `main` and Vercel deploys automatically. Add `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in Vercel → Project → Settings → Environment Variables.

## Docs

- [docs/API.md](docs/API.md) – API contract, model routing, keys
- [docs/DNS-SETUP.md](docs/DNS-SETUP.md) – Domain setup
- [tools/README.md](tools/README.md) – Python tools
