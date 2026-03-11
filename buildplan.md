# openmud Build Plan

## North Star

openmud is not a generic chat app. It is an agentic construction work platform for underground utility subcontractors, small heavy civil contractors, estimators, and PMs.

The product wins when a user can say what job they need done in chat and openmud finishes the workflow:

- extract project facts from documents
- generate a professional proposal
- build a field-ready schedule
- draft an RFI or subcontractor email
- generate a change order
- prepare estimating inputs
- learn from historical bids and jobs

Every feature should support one of these outcomes:

- win work
- price work
- document work
- get paid
- protect margin
- reduce admin time

## Best V1

The best first shipping version is:

1. document-aware proposal generator
2. document-aware schedule builder
3. project context extraction from uploaded docs and project data

This is the right V1 because it is:

- easy to explain
- immediately useful
- close to revenue
- valuable for both beginners and experienced contractors
- a natural foundation for change orders, estimating, and takeoffs

## Product Strategy

### Chat is the control surface

The chat interface should orchestrate tools, not replace them.

The user should be able to say:

- "build a proposal from these project docs"
- "generate the schedule for this sewer job"
- "turn this extra work note into a change order"
- "draft the email to the GC"

The system should:

1. detect the workflow
2. collect project context
3. extract structured facts from project docs
4. run the right tool
5. return a professional artifact

### Shared construction memory

All workflows should read from the same project context:

- project name
- owner / client / GC
- location
- scope summary
- uploaded documents
- extracted facts
- bid items
- schedule assumptions
- company profile
- historical job intelligence

### Paid and free plan strategy

Free should be genuinely useful:

- limited projects
- limited document extraction
- limited proposal and schedule drafts
- calculators
- beginner resources and guidance
- starter workflows

Paid should clearly save money and time:

- unlimited projects
- unlimited extraction
- professional proposals
- schedule builder
- change orders
- estimating workflows
- historical bid / project database
- premium automation

The free plan teaches the workflow.
The paid plan finishes the work at scale.

## Build Discipline

When making product decisions, prefer:

1. workflow completion over general chat quality
2. structured project data over one-off prompts
3. deterministic output builders over raw model prose
4. reusable extraction contracts over ad hoc parsing
5. tools that save real hours over novelty

Avoid:

- broad generic assistant behavior
- features without a margin / admin / revenue story
- disconnected tools with no shared project memory
- shipping wrappers before core workflows work

## Two-Week Execution Plan

### Week 1

- lock in proposal generator from project docs
- lock in schedule builder from project docs
- add structured workflow extraction in chat
- make project document context first-class
- save outputs back into project context where practical
- test with real underground utility and heavy civil sample jobs

### Week 2

- improve extraction quality for plans/specs/bid docs
- add change order workflow
- add email / RFI drafting from project context
- define estimating database model
- start historical bid / project intelligence scaffolding

## Engineering Strategy

Build the core product here in this repo first.

Use cloud agents for:

- code review
- test generation
- research
- repetitive refactors

Do not outsource product thinking to cloud agents.
The domain logic, workflow contracts, and final product decisions should stay grounded in this codebase and your real construction expertise.

## Immediate Implementation Priorities

1. `web/api/chat.js` becomes the workflow orchestration layer
2. project docs and project data feed structured workflow extraction
3. proposal generator returns professional HTML and chat metadata
4. schedule generator returns structured schedule output for UI rendering
5. tests cover proposal and schedule generation from real project context
