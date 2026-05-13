# Handover — VS Code Agent Manager v1.3.0 (post-compaction)

> Purpose: hand the conversation back to a fresh Copilot session after `/compact`. Read this first.

## Current ship state

- Repo: `C:\Users\purpl\VS-Code-Agent-Manager` ↔ `https://github.com/BarnsL/VS-Code-Agent-Manager`.
- Branch: `master`. HEAD: **`70ff24b`** (origin/master matches; pending docs commit on top).
- Version: `1.3.0` in `package.json`.
- Last VSIX built/installed: `vs-code-agent-manager-1.3.0.vsix` (85.35 KB, 32 files).
- Build: `npm run compile` clean. Tests: `node --test dist/workflowAutomation.test.js` → 8/8 pass. No tests yet for `managerLlm.ts`.

## Recent commits (newest first)

| SHA | Subject |
|---|---|
| `70ff24b` | feat(v1.3.0): autonomous mode runs steps via vscode.lm and auto-captures output |
| `4717b3a` | fix: remove legacy 'estimated from Agent Manager launches' usage note |
| `884c536` | feat(v1.2.0): LLM-driven manager, single-step planning, hard output gate |
| `e34b5ef` | feat(v1.1.0): manager-mediated sequential flow, parallel lanes, agent reassignment |

## v1.3.0 architecture additions

- **Autonomous mode** per ticket. `AgentTicket.autonomousMode?: boolean` in `src/state.ts`; toggled via `setTicketAutonomousMode` and the new `copilot-agents.setAutonomousMode` command.
- **`runStepAutonomously`** in `src/managerLlm.ts` calls `vscode.lm.sendRequest` with the agent's `.agent.md` body as the system message. Returns `{kind:'completed'|'no-model'|'lm-error'}`. Empty responses coerced to `lm-error`.
- **`launchTicketStep`** branches on `autonomousMode`: if ON, records launch with source `ticket-workflow-autonomous`, runs `runStepAutonomously`, then routes the captured output through `submitStepOutput` so analyzer + planner + continuous-mode chaining behave identically to the manual paste path.
- **Dashboard** has a second toggle next to Continuous mode; the textarea placeholder flips to an autonomous-aware copy when enabled.
- Hard output gate, single-step planner, structured analyzer, and `skipStep` override from v1.2.0 are all preserved.

## v1.2.0 architecture (still applies)

1. **Single-step seeding.** `buildWorkflow` in `src/state.ts` queues only the LEAD step at ticket creation. Subsequent steps are appended dynamically by `appendDynamicStep` AFTER the prior step's chat output is captured.
2. **LLM-driven manager.** New `src/managerLlm.ts`:
   - `planNextStep(...)` calls `vscode.lm.selectChatModels({vendor:'copilot'})` and asks for ONE next step. Returns a discriminated `{kind: 'planned'|'done'|'no-model'|'parse-error'|'lm-error'}`.
   - `analyzeStepOutputWithLm(...)` produces structured JSON `{headline, keyPoints, openQuestions, artifacts}`. Falls back to the v1.1.0 heuristic ONLY for the analysis preview when no LM is available; planning has NO heuristic fallback by design.
   - JSON contract is parsed with fence-stripping + outermost-`{...}` extraction in `tryParsePlannerJson` / `tryParseAnalysisJson`.
3. **Hard output gate.** `submitStepOutput` in `src/extension.ts` is the ONLY path that advances a ticket. `completeTicketStep` rejects empty output (no more InputBox shortcut). Explicit `copilot-agents.skipStep` command exists for the bypass case (requires a typed reason; does NOT trigger LM planning).
4. **Tailored per-step prompt.** `buildTicketQuery` appends the LM-planner's `customPrompt` under `## Manager's tailored instructions for this step` (only when the step's `prompt` differs from the ticket's original prompt — so the seed step doesn't double-inject).
5. **Usage note removed.** `DEFAULT_USAGE.dataSourceNote` is now `""`. `normalizeUsage` actively blanks the legacy note string if it was previously persisted to globalState. Dashboard skips rendering `<div class="usage-note">` when empty.

## Files of interest

- [src/state.ts](../src/state.ts) — `buildWorkflow` (single seed), `appendDynamicStep`, `markStepAwaitingOutput`, `completeActiveStep`, `setTicketContinuousMode`, `spawnParallelLane`, `reassignStepAgent`, `normalizeUsage` (legacy-note migration).
- [src/managerLlm.ts](../src/managerLlm.ts) — `planNextStep`, `analyzeStepOutputWithLm`, `formatAnalysisAsMarkdown`, `selectModel`, JSON parsers exposed via `__test__`.
- [src/extension.ts](../src/extension.ts) — `submitStepOutput` (hard gate, calls LM analyzer + planner), `completeTicketStep` (rejects empty), `skipTicketStep`, `buildTicketQuery` (appends tailored instructions), command registrations including `copilot-agents.skipStep`.
- [src/dashboardView.ts](../src/dashboardView.ts) — usage-note div now conditional.
- [src/workflowAutomation.ts](../src/workflowAutomation.ts) — kept as v1.1.0 fallback used by analyzer-only path.
- [package.json](../package.json) — version `1.2.0`, new `copilot-agents.skipStep` contribution.

## Known gotchas / quirks

- **PowerShell + `git push`:** the inline credential-helper push prints git's stderr `To https://…` line as PowerShell error, so the command exits non-zero even on success. Always check the last line — if it shows `<old>..<new>  master -> master` the push succeeded. Pattern:
  ```powershell
  $token = gh auth token
  git -c credential.helper= -c credential.helper="!f() { echo username=BarnsL; echo password=$token; }; f" push https://github.com/BarnsL/VS-Code-Agent-Manager.git master
  ```
- **CRLF warnings on `dist/*.js`** during `git add` are harmless; `dist/` is committed by repo convention from v1.1.0.
- **No tests for `managerLlm.ts`** yet — listed as a v1.2.1 quick-win.
- **Submit double-click race:** `submitStepOutput` has no in-flight guard, so a double-click could fire two LM planning calls and append two queued steps. v1.2.1 item B.
- **Parallel lanes invisible to planner:** `planNextStep` only sees `steps.filter(status==='done')`, never `ticket.lanes`. v1.2.1 item A.

## Outstanding ideas (not yet tickets)

Recommended v1.2.1 quick-win shortlist (≈ one evening):

1. In-flight guard on `submitStepOutput` (~10 LOC).
2. New `src/managerLlm.test.ts` covering the JSON parsers (~60 LOC).
3. Feed `ticket.lanes` into the planner context (~15 LOC).
4. Auto-prepend `@<agentName>` to `customPrompt` if missing (~3 LOC).
5. Drop the legacy headline fallback in `buildAutomaticHandoffSummary` (~5 LOC).

v1.3.0 candidates: re-plan affordance after `parse-error`/`lm-error`, richer agent context for planner (include `.agent.md` body excerpt), per-ticket LM-call counter + opt-out, prompt-eval harness against current LM, lane ↔ main-timeline integration.

## User preferences to remember

- Wants commit + push without extra prompting when changes are expected to ship.
- Strict version/filename sync — VSIX name matches `package.json` version.
- Likes thorough handover/process docs for major iterations.
- Wants the manager LLM-driven the entire way; no silent regression to heuristics for planning.
- Hates the regression where the queue spammed all steps at once or auto-marked tickets done.

## Build / package / install / push reference

```powershell
cd C:\Users\purpl\VS-Code-Agent-Manager
npm run compile
node --test dist/workflowAutomation.test.js
npx vsce package --allow-missing-repository
& 'C:\Users\purpl\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd' --install-extension .\vs-code-agent-manager-1.2.0.vsix --force
git add -A
git commit -m "<conventional message>"
$token = gh auth token
git -c credential.helper= -c credential.helper="!f() { echo username=BarnsL; echo password=$token; }; f" push https://github.com/BarnsL/VS-Code-Agent-Manager.git master
```

## Resume checklist after compaction

1. Read this file first.
2. `cd C:\Users\purpl\VS-Code-Agent-Manager; git status; git log --oneline -3` to confirm HEAD = `4717b3a`.
3. If the user asks to verify v1.2.0 behavior, run the 7-point checklist:
   1. New ticket queues only the lead step.
   2. Submit empty → warning, no advance.
   3. Submit real output → exactly one tailored next step appended.
   4. Skip Step requires a reason and does NOT trigger LM planning.
   5. No model available → warning surfaced, ticket parked.
   6. Continuous mode auto-launches the next step.
   7. Chat prompt contains both prior-chain handoff and tailored instructions.
4. If the user asks "what's next", offer the v1.2.1 quick-win shortlist above.
