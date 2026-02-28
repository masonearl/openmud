# openmud

**Open-source AI for heavy civil and underground utility construction.**

[openmud.ai](https://openmud.ai) · [Contributing](#contributing) · [Deploy your own](#deploy-your-own)

---

openmud is a free, open-source AI assistant built specifically for the construction industry — contractors, PMs, estimators, and field engineers working in underground utility, earthwork, and heavy civil.

It understands trenching, pipe sizing, labor and equipment rates, phased scheduling, and the bid workflows contractors actually use. Not a generic AI with a construction coat of paint.

**Try it live → [openmud.ai](https://openmud.ai)**

---

## Demo

> **Ask the AI:** *"Give me a quick estimate for 800 LF of 8-inch waterline — materials, labor, and equipment."*

The AI returns a structured cost breakdown, which you can export to PDF or turn into a proposal in one click. The Quick Estimate form does the same thing without AI — just fill in quantities and get a line-item cost breakdown.

*(Screenshot / GIF coming — [open a PR](https://github.com/masonearl/openmud/pulls) if you want to add one)*

---

## Who it's for

- **Estimators** — get material, labor, and equipment cost breakdowns for underground work fast
- **PMs and supers** — build schedules, generate proposals, and answer scope questions
- **Field engineers** — quick answers on specs, pipe sizing, trench depth, compaction
- **Developers** — building AI tools for construction and want a working starting point

---

## What it does

| Feature | Description |
|---|---|
| AI chat | Multi-model chat (OpenAI GPT-4o, Claude) tuned for heavy civil |
| Quick estimate | Material, labor, and equipment cost calculator for common underground work |
| Schedule generator | Phased construction schedule — downloadable as PDF |
| Proposal generator | Formatted proposal from your estimate, ready to send |
| **Calculators** | 18 construction calculators — trench volume, pipe flow, OSHA safety, markup, production rates, unit converter, pipe reference, Manning's n, and more |
| Python tool library | Estimating, hydraulics, trench takeoff, safety, bid math, and unit conversion tools |

---

## Quick start (local)

```bash
git clone https://github.com/masonearl/openmud.git
cd openmud

npm install
cp config/env.example .env.local
# Add your OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.local

vercel dev
# → http://localhost:3000
```

Or static only (no API):

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

---

## Deploy your own

1. Fork this repo
2. Connect to [Vercel](https://vercel.com) (free tier works)
3. Add environment variables in Vercel → Project → Settings → Environment Variables:
   - `OPENAI_API_KEY` — from [platform.openai.com](https://platform.openai.com)
   - `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
4. Deploy — your own AI construction assistant is live

---

## Project structure

```
openmud/
├── api/                        # Serverless API (runs on Vercel)
│   ├── chat.js                 # Multi-model chat: OpenAI + Anthropic
│   ├── schedule.js             # Phased schedule generator
│   ├── proposal.js             # Proposal HTML generator
│   ├── predict.js              # Estimate proxy
│   ├── feedback.js             # Feedback handler
│   └── health.js               # Health check
├── assets/
│   ├── css/styles.css          # App styles
│   └── js/app.js               # Frontend logic
├── config/
│   └── env.example             # Environment variable template
├── docs/
│   ├── API.md                  # API reference
│   └── ROADMAP.md              # What's coming next
├── tools/                      # Python tool library
│   ├── estimating/             # Material, labor, equipment calculators
│   ├── schedule/               # Schedule generation
│   ├── proposal/               # Proposal generation
│   ├── registry.py             # OpenAI-compatible tool schemas
│   └── README.md               # Python tools documentation
├── index.html                  # Main app
├── about.html
├── documentation.html
├── package.json
└── vercel.json
```

---

## Calculators

**[openmud.ai/calculators](https://openmud.ai/calculators)** — 18 free construction calculators, all client-side (no sign-up, works offline after load):

| Category | Calculators |
|---|---|
| Takeoff & Quantities | Trench Volume, Concrete Volume, Asphalt Tonnage, Pipe & Fittings |
| Engineering & Field | Pipe Flow (Manning's), Minimum Pipe Slope, Trench Safety (OSHA), Thrust Block, Grade & Slope, Compaction |
| Cost & Bid | Markup & Bid Price, Unit Price Builder, Change Order, Production Rate, Crew Day Cost |
| Reference | Unit Converter, Pipe Reference Table, Manning's n Values |

---

## Python tools

The `tools/` directory contains a standalone Python library you can use independently of the web app:

```python
from tools import (
    estimate_project_cost, calculate_material_cost,
    pipe_flow_full, minimum_slope,
    trench_volume, thrust_block,
    markup_bid_price, production_rate,
    convert,
)

# Full project estimate
estimate = estimate_project_cost(
    materials=[{"type": "pipe", "quantity": 500, "size": "8"}],
    labor=[{"type": "operator", "hours": 80}, {"type": "laborer", "hours": 160}],
    equipment=[{"type": "excavator", "days": 10}],
    markup=0.15,
)

# Pipe flow — 12" RCP at 0.5% slope
flow = pipe_flow_full(12, 0.005)
print(flow["flow_gpm"])  # → 748.3 GPM

# Trench volumes for 500 LF of 8" waterline
vol = trench_volume(500, width_ft=3.5, depth_ft=6, pipe_od_in=8)
print(vol["excavation_cy"])  # → 388.9 CY

# Bid price with 12% overhead, 10% profit
bid = markup_bid_price(250000, overhead_pct=12, profit_pct=10)
print(bid["bid_price"])  # → $308,000.00

# Unit conversion
convert(10, "cy", "cf", "volume")  # → 270.0 CF
```

Full tool reference: [tools/README.md](./tools/README.md)

---

## AI models supported

| Model | Provider |
|---|---|
| GPT-4o, GPT-4o-mini | OpenAI |
| Claude Sonnet, Claude Haiku | Anthropic |
| mud1 (default) | GPT-4o-mini tuned for heavy civil |

---

## Contributing

openmud is built by and for construction people. Every contribution matters — better pricing data, new tools, improved prompts, bug fixes.

**You do not need to be a developer to help.**

- Submit pricing corrections (material, labor, equipment rates) through an issue
- Share AI prompt workflows that worked for your crew/PM/estimator use case
- Report bad or unclear AI answers with the exact prompt and expected answer
- Suggest tool ideas from real field workflows (change orders, RFIs, takeoff pain points)

**Things we'd love help with:**

- More accurate regional pricing (pipe, concrete, rebar, labor rates)
- New tool types: change orders, RFIs, daily reports, takeoff calculator
- Better AI prompts for specific trade work (waterline, sewer, storm, electrical, gas)
- Integrations: Procore, Buildertrend, Autodesk, Bluebeam
- Mobile-friendly UI improvements

**To contribute:**

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Open a PR — describe what you built and why it matters in the field

See [CONTRIBUTING.md](./.github/CONTRIBUTING.md) for full details and no-code contribution paths.

---

## Roadmap

- [ ] User-editable rate codebooks (labor, equipment, materials)
- [ ] Real tool calling wired to Python estimating tools
- [ ] Invoice generator
- [ ] Takeoff calculator
- [ ] PDF upload → AI reads your specs
- [ ] Change order and RFI tracking
- [ ] Notion / project management integrations

Full roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)

---

## Community

- **[GitHub Discussions](https://github.com/masonearl/openmud/discussions)** — questions, ideas, show your builds
- **[Open Issues](https://github.com/masonearl/openmud/issues)** — bugs, feature requests, pricing corrections
- **[Good first issues](https://github.com/masonearl/openmud/issues?q=label%3A%22good+first+issue%22)** — new here? start here

---

## License

MIT — free to use, fork, and build on.

---

*Built on [openmud.ai](https://openmud.ai). Related project: [mudrag.ai](https://mudrag.ai)*
