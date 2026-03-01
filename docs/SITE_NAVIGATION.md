# openmud Site Navigation Map

## Primary Page Tree

/
- /about.html
- /chat.html
  - /chat.html?tool=estimate
  - /chat.html?tool=proposal
  - /chat.html?tool=schedule
- /calculators.html
  - #trench-volume
  - #pipe-flow
  - #trench-safety
  - #thrust-block
  - #markup
  - #change-order
  - #production-rate
  - #unit-converter
  - #estimator
- /resources.html
  - #osha-excavation
  - #bluestakes
  - #ai-guide
  - #ai-workflows
  - #ai-autonomy
  - #software-architecture
  - #youtube
  - #glossary
- /innovators.html
- /companies.html
  - #esop
  - #market-data
- /documentation.html

## Flow Decisions

- `Project Tools` from landing/about now routes to chat tool mode, not calculators:
  - `/chat.html?tool=estimate`
- Rationale: the user can immediately run/edit estimate, then chain to proposal/schedule in the same conversation context.

## Navigation Consistency Updates

- Added missing top-nav consistency so major pages are reachable from primary nav:
  - Added `About` + `Documentation` to `/`
  - Added `Documentation` to `/about.html`, `/resources.html`, `/innovators.html`, `/companies.html`
  - Added `Innovators` to `/resources.html`

## Known UX Pattern for Hash Links

- `resources.html` and `companies.html` use `#hash` + JS section activation (`section-<hash>`).
- `calculators.html` uses `#hash` + JS panel activation (`panel-<hash>`).
- This is intentional and supports direct deep links from the landing page.

