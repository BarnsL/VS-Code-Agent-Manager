# v1.3.1 — Completion Evidence Guard

## Problem addressed

In v1.3.0 autonomous mode, implementation-style tickets could be marked done
when the planner inferred completion from narrative output, even when no real
workspace artifacts were produced.

## Fix

The manager now performs a code-side completion guard before honoring
`plan.kind === "done"` for implementation-heavy requests.

- `requestLikelyNeedsArtifacts(prompt)` classifies implementation-style work.
- `hasConcreteArtifactEvidence(ticket)` scans completed-step analysis for
  backticked file paths and verifies those paths exist in workspace folders.
- If the request needs artifacts but no evidence exists, the manager does NOT
  complete the ticket. Instead it appends a new step:
  - title: `Completion Evidence Check`
  - agent: `@verification-before-completion` when available, else `@maintainer`, else the active agent
  - prompt: requires explicit produced file paths + what changed + build/test output.
- In continuous mode, this evidence step auto-launches immediately.

## Planner hardening

`src/managerLlm.ts` planner instructions now explicitly forbid `done=true` for
implementation-heavy requests unless concrete repository artifacts or
verification evidence are present.

The planner prompt now also includes each prior step's manager analysis to
improve visibility into artifacts/open questions.

## Files changed

- `src/extension.ts`
- `src/managerLlm.ts`
- `package.json` (version `1.3.1`)
- `README.md`

## Validation

```powershell
npm run compile
node --test dist/workflowAutomation.test.js
```
