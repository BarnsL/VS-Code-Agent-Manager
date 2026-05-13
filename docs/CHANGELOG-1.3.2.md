# v1.3.2 — Grounded Routing and Planner Sanity Checks

## Problem addressed

Two assignment failures were still possible after v1.3.1:

- Ticket creation could start from hardcoded canonical agent names (`brainstorming`, `subagent-driven-development`, etc.) instead of the actual agents discovered in the current VS Code environment.
- The LLM next-step planner could emit an unrelated step title / agent assignment that still parsed as valid JSON, so the manager would accept an off-task plan and queue it.

## Fixes

### Real-agent routing

`routeTask` now accepts the currently available agents and resolves canonical agent families onto the real discovered inventory.

Examples:
- If a rule says `subagent-driven-development` but the environment only has `maintainer` and `Developer`, routing now maps to the best real match.
- If the prompt is about testing / verification, review-oriented agents are scored up.
- If the prompt is about automation / workflow improvements, implementation-oriented agents are scored up.

This change is used by:
- command-palette routing
- `@route`
- ticket creation
- seeded roadmap tickets

### Planner sanity check

After the planner returns JSON, the manager now:

1. normalizes the chosen agent name onto a real available agent,
2. checks whether the proposed step title / custom prompt is grounded in the ticket request or prior outputs / analyses,
3. rejects the plan if it is off-task.

When the plan is rejected, the manager queues a **Re-scope Next Step** step instead of accepting the hallucinated assignment.

## Files changed

- `src/agents.ts`
- `src/managerLlm.ts`
- `src/extension.ts`
- `package.json`
- `README.md`

## Validation

```powershell
npm run compile
node --test dist/workflowAutomation.test.js
```
