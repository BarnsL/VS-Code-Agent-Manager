# Release 1.1.0 — Manager-Mediated Workflow, Parallel Lanes, Agent Reassignment

This release rewrites the multi-agent workflow loop. v1.0.0 fired chat queries
in a tight `while` loop without ever inspecting the agent's chat output — that
caused later agents to proceed without any of the prior agent's actual work.
v1.1.0 replaces that loop with a strict, output-gated, manager-mediated
sequence inspired by orchestration patterns from
[`amazon-q-developer-cli`](https://github.com/aws/amazon-q-developer-cli) and
[`patoles/agent-flow`](https://github.com/patoles/agent-flow):

> **Manager runs step N → user pastes step N's chat output → manager analyzes →
> manager composes step N+1 prompt with step N's output quoted verbatim →
> launches step N+1.**

Each transition is gated on the presence of captured output. There is no
unattended advance unless the user explicitly enables Continuous Mode for that
ticket.

---

## Headline changes

### 1. Output-gated sequential advance
- New step status `awaiting-output` between `active` and `done`.
- New per-step fields `output` (raw chat text) and `analysis` (manager summary).
- New `submitStepOutput(ticketId, output)` extension command.
- The blind `while (safety++ < 12)` loop in `autoDriveTicket` is gone.
  `copilot-agents.autoDriveTicket` is preserved as a backwards-compatible
  alias that performs exactly **one** structured advance.

### 2. Manager analysis + structured next-prompt
- `analyzeStepOutput(...)` extracts headline, key points, and open questions
  from the captured chat output (no LLM call — runs locally so it never burns
  premium requests).
- `buildStructuredHandoffPrompt(...)` composes the next agent's prompt with
  every prior step's chat output quoted verbatim under explicit headings
  (`Raw chat output:`, `Manager analysis:`, `Handoff summary:`).
- The next agent always works from the actual deliverable, not a synthesized
  one-liner.

### 3. Per-ticket Continuous Mode
- Each ticket carries a `continuousMode` flag. When ON, submitting output
  auto-launches the next agent. When OFF (default), the manager pauses for
  user review between agents.
- New command `copilot-agents.setContinuousMode`.
- The dashboard renders a per-ticket checkbox toggle.

### 4. Parallel side-chat lanes
- New `TicketLane` model (`id`, `agentName`, `prompt`, `status`, `output`).
- New command `copilot-agents.spawnParallelLane(ticketId, agentName?, prompt?)`
  opens a side chat with the chosen agent that runs alongside the main
  timeline.
- Each lane is rendered on its ticket card with status pills.

### 5. Agent reassignment without restart
- New command `copilot-agents.reassignStepAgent(ticketId, stepId, agentName?)`.
- Swaps the assignee on the active or any queued step in place.
- Dashboard exposes a **Reassign Agent** button on the active step.

### 6. Dashboard UI overhaul
- Per-step output textarea with **Submit Output + Analyze** button on every
  active / awaiting-output step.
- Per-ticket **Continuous mode** toggle + **Spawn Parallel** action.
- Manager analysis preview rendered as a collapsible `<details>` block under
  the most recent completed step.
- Workflow Queue surfaces awaiting-output steps so they don't get lost.
- Removed the global `#workflow-result` textarea — output is now per-step.

---

## File-by-file map

| File | What changed |
|---|---|
| `src/state.ts` | Added `awaiting-output` status, `output`/`analysis`/`laneId` on `WorkflowStep`, `TicketLane` interface, `lanes`/`continuousMode` on `AgentTicket`. New store methods: `markStepAwaitingOutput`, `reassignStepAgent`, `setTicketContinuousMode`, `spawnParallelLane`. `completeActiveStep` now takes `(ticketId, summary, { output?, analysis? })`. Snapshot queue now surfaces `awaiting-output`. |
| `src/workflowAutomation.ts` | Added `analyzeStepOutput` (headline/key-points/open-questions extractor) and `buildStructuredHandoffPrompt` (verbatim prior-output quoter). `getQueueActionLabel` now returns `Submit Output + Advance` for awaiting-output / active+auto cases and `Mark Step Complete` for active+manual. `shouldAutoProceedWorkflow` now refuses to advance when `hasCapturedOutput === false`. |
| `src/workflowAutomation.test.ts` | Updated existing label/auto-proceed tests; added analyzer + structured-prompt coverage. |
| `src/extension.ts` | Removed blind `autoDriveTicket` loop. New functions: `submitStepOutput`, `reassignStepAgent`, `spawnParallelLane`, `setContinuousMode`. New commands wire to those. `buildTicketQuery` now uses `buildStructuredHandoffPrompt`. `createTicketFromPrompt` no longer auto-launches step 1 unless the ticket explicitly has `continuousMode: true`. |
| `src/dashboardView.ts` | New `DashboardActions` shape; new message switch cases for `submitStepOutput`, `reassignStepAgent`, `spawnParallelLane`, `setContinuousMode`; per-step output textarea, manager-analysis preview, lanes block, continuous-mode toggle. New CSS for the new panels. |
| `package.json` | Bumped `version` to `1.1.0`; added contributions for `submitStepOutput`, `reassignStepAgent`, `spawnParallelLane`, `setContinuousMode`. |
| `README.md` | Rewrote Features / Usage / Commands sections to reflect manager-mediated flow. |
| `docs/ARCHITECTURE.md` | New \u2014 architecture overview + Mermaid sequence diagram. |
| `docs/AUTOMATION-MODEL.md` | New \u2014 explains Manual / Continuous / Parallel modes. |

---

## Migration notes

- `copilot-agents.autoDriveTicket` is still available but performs a single
  manager-mediated advance. Existing keybindings keep working.
- `DashboardActions.autoDriveTicket` was replaced by `submitStepOutput`,
  `reassignStepAgent`, `spawnParallelLane`, and `setContinuousMode`. Any
  third-party consumers should switch to those.
- The `#workflow-result` global textarea was removed in favor of per-step
  textareas inside each ticket card.
