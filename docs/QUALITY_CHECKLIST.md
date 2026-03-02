# openmud Quality Checklist

This checklist defines the minimum quality gate for every pull request to `main`.

## Phase 1 - CI Gates (implemented)

1. **Python quality gate**
   - Run Python tool tests with coverage.
   - Run Python lint checks on `tools/`.
   - Block merge on failures.

2. **Chat e2e regression gate**
   - Run Playwright tests for key chat behavior:
     - Agent mode sends `use_tools=true`.
     - Ask mode sends `use_tools=false`.
     - Quick estimate form returns structured output.
     - API failure surfaces safe user-facing fallback.
   - Block merge on failures.

3. **Site bot synthetic gate**
   - Run `scripts/site-bot.js` in CI against a local static build.
   - Audit core pages plus chat probes.
   - Enforce severity threshold with `BOT_FAIL_ON`.
   - Upload bot reports as CI artifacts for review.

## Next Recommended Phases

1. **Preview/production promotion gate**
   - Deploy PR preview first.
   - Require passing checks before production promotion.

1. **Production monitoring + alerting**
   - Schedule site-bot runs on production.
   - Alert on critical/high findings and endpoint errors.

1. **Performance and accessibility guardrails**
   - Add Lighthouse CI budget checks.
   - Add axe-based accessibility checks for critical flows.
