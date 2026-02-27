# Contributing to openmud

Thanks for wanting to help. openmud is built by construction people for construction people — your real-world knowledge is as valuable as your code.

---

## Ways to contribute

### Improve the pricing data

The estimating tools use hardcoded rates in `tools/estimating/estimating_tools.py`. These are ballpark numbers and vary significantly by region, market conditions, and job type. If you know better numbers, submit a PR.

Examples we need:
- Regional pipe pricing (HDPE, ductile iron, PVC, steel)
- Current union vs. open shop labor rates by trade
- Equipment rental rates (excavator, compactor, drill rig, vacuum excavator)
- Concrete and backfill material costs

### Add a new tool

Good candidates:
- **Change order generator** — scope + quantities → formatted CO document
- **RFI tracker** — log, status, response tracking
- **Daily report** — auto-fill from crew/weather/work data
- **Takeoff calculator** — linear feet, cubic yards, tons from plan dimensions
- **Bid comparison** — compare subcontractor bids side by side
- **Invoice generator** — from approved pay app or proposal

### Improve AI prompts

The system prompts live in `api/chat.js` under `SYSTEM_PROMPTS`. If you work in construction and the AI gives bad answers, open an issue or submit a PR with better prompt language.

### Build integrations

- Procore API — push/pull project data
- Autodesk Construction Cloud — drawings and RFIs
- Bluebeam — markup and takeoff data
- QuickBooks — export estimates as invoices

### Fix bugs or improve the UI

Check [open issues](../../issues) — anything tagged `good first issue` is a good starting point.

---

## Getting set up

```bash
git clone https://github.com/masonearl/openmud.git
cd openmud

npm install
cp config/env.example .env.local
# Add OPENAI_API_KEY and/or ANTHROPIC_API_KEY to .env.local

vercel dev
```

For Python tools only (no Node/Vercel needed):

```bash
cd tools
pip install -r requirements.txt
python3 -c "from estimating.estimating_tools import calculate_material_cost; print(calculate_material_cost('pipe', 500, '8'))"
```

---

## Submitting a pull request

1. Fork the repo and create a branch: `git checkout -b feat/your-feature-name`
2. Keep PRs focused — one thing per PR
3. Test your changes locally
4. Open the PR and describe:
   - What you changed
   - Why it matters in real construction work
   - How to test it

---

## Opening an issue

Use issues for:
- **Bug reports** — something broken
- **Pricing corrections** — rates that are off
- **Feature ideas** — something you wish the tool could do
- **Prompt feedback** — cases where the AI gave a bad or wrong answer

The more real-world context you give, the better.

---

## Code style

- JavaScript: keep it simple, no frameworks for simple things
- Python: PEP 8, type hints where practical, clear docstrings
- No AI-generated filler comments

---

## Questions?

Open a [discussion](../../discussions) or file an issue.
