# v1.3.0 — Autonomous Mode

## Headline change

Each ticket now has an **Autonomous mode** toggle. When ON, the manager runs each
workflow step directly through the VS Code Language Model API
(`vscode.lm.sendRequest`) instead of opening the Copilot Chat panel for a human
to paste the response back. The full streamed response is captured and fed
straight back through the existing analyzer + planner pipeline, so:

- The hard output gate (v1.2.0) still applies — empty LM responses fail closed.
- The LLM analyzer still produces a structured `{headline, keyPoints, openQuestions, artifacts}` summary.
- The LLM planner still decides exactly ONE next step at a time and tailors its `customPrompt` to the verbatim prior outputs.
- With **Continuous mode** also ON, the planner-decided next step launches automatically — a ticket runs end-to-end with zero human paste.

## Why

Even with the v1.2.0 manager, every step still required a human to paste the
agent's chat response back into the ticket card. The Copilot Chat extension
host does not expose a supported way for an extension to read tokens out of
the running chat session, so the only way to fully close the loop was to bypass
the chat panel for steps that don't need real chat-participant tool side
effects.

## What was added

### `src/state.ts`
- New optional field `AgentTicket.autonomousMode?: boolean`.
- New method `AgentOpsStore.setTicketAutonomousMode(ticketId, enabled)` mirroring `setTicketContinuousMode`. Records `ticket-autonomous-mode-toggled` activity events.

### `src/managerLlm.ts`
- New exported function `runStepAutonomously({prompt, agentName, agentBody, onChunk?, cancellationToken?})`.
  - Uses the existing `selectModel()` helper (Copilot vendor preferred).
  - Injects the agent's `.agent.md` body (frontmatter + prose) as part of the system message so the LM behaves like the chat participant would.
  - Streams the response, returning a discriminated union: `{kind:"completed", output}` | `{kind:"no-model"}` | `{kind:"lm-error", error}`.
  - Empty LM responses are coerced into `lm-error` rather than silently advancing.

### `src/extension.ts`
- `launchTicketStep` now branches on `started.ticket.autonomousMode`:
  - **Autonomous ON:** records the launch with source `ticket-workflow-autonomous`, calls `runStepAutonomously`, then routes the captured output through the existing `submitStepOutput` so analysis + planning + continuous-mode chaining behave identically to the manual-paste path.
  - **Autonomous OFF:** unchanged — opens Copilot Chat with `workbench.action.chat.open`.
- New action `setAutonomousMode(ticketId, enabled)` and dashboard action wiring.
- New command `copilot-agents.setAutonomousMode` (palette + programmatic), with QuickPick fallback when invoked without arguments.

### `src/dashboardView.ts`
- New `DashboardActions.setAutonomousMode(ticketId, enabled)` interface method.
- New webview message handler `case "setAutonomousMode"`.
- New per-ticket toggle next to **Continuous mode**, labelled "Autonomous mode (run steps via language model API — no chat paste required)".
- The step textarea placeholder now flips to an autonomous-aware copy when the ticket is in autonomous mode.
- The change-event listener handles both `setContinuousMode` and `setAutonomousMode`; the click suppression also covers the new toggle so it doesn't double-post.

### `package.json`
- Version bump `1.2.0` → `1.3.0`.
- Description updated to mention "autonomous LM execution".
- New command contribution `copilot-agents.setAutonomousMode` (icon `$(zap)`, title "Toggle Ticket Autonomous Mode").

## What was NOT changed

- The v1.2.0 hard output gate, single-step planner, structured analyzer, and `skipStep` override are all preserved verbatim.
- The chat-paste flow remains the default for new tickets — `autonomousMode` defaults to `undefined` (= falsy) and must be opted-in per ticket.
- The fallback heuristic analyzer in `workflowAutomation.ts` is still wired in for the no-model case.

## Caveats and limitations

- **No chat-participant tools.** Autonomous mode talks to the language model directly, so any tool calls the agent would normally make through Copilot Chat (file edits, terminal runs, semantic search, etc.) do **not** execute. Use autonomous mode for text-deliverable agents (brainstorming, planning, analysis, review) and use the chat-paste flow for steps that need real tool side effects.
- **No live streaming UI yet.** The `onChunk` hook on `runStepAutonomously` is plumbed through but the dashboard does not yet render the streaming text live — the user sees the captured output appear in the step textarea after the run completes. Live streaming is a candidate for v1.3.1.
- **Single-shot per step.** Each autonomous run is a single LM request; the agent does not get to chain its own internal reasoning steps the way a chat participant might. The manager still chains by planning the *next* step.
- **Empty response = error.** If the LM returns an empty string, `runStepAutonomously` returns `lm-error` and the step is parked rather than auto-marked done.

## Verification

```powershell
cd C:\Users\purpl\VS-Code-Agent-Manager
npm run compile                                      # tsc clean
node --test dist/workflowAutomation.test.js          # 8/8 pass
npx vsce package --allow-missing-repository          # vs-code-agent-manager-1.3.0.vsix (85.35 KB, 32 files)
& 'C:\Users\purpl\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd' --install-extension .\vs-code-agent-manager-1.3.0.vsix --force
```

Manual smoke test:

1. Open the Control Center.
2. Create a ticket, e.g. "Brainstorm three improvements for X".
3. On the ticket card tick **Autonomous mode** and **Continuous mode**.
4. Click **Run Next Step**.
5. Expect: the step launches without opening Copilot Chat; after a few seconds the captured output appears in the textarea; the manager analyzer + planner runs; the next step launches automatically; loop continues until the planner reports `done` (or until you uncheck Autonomous to step through manually).

## Commits / push

- Implementation: `70ff24b feat(v1.3.0): autonomous mode runs steps via vscode.lm and auto-captures output`.
- Pushed `10416ed..70ff24b master -> master` to `https://github.com/BarnsL/VS-Code-Agent-Manager`.

## Suggested v1.3.1 follow-ups

1. Live-stream the autonomous output into the step textarea via `onChunk` + a webview `appendStepOutput` message.
2. In-flight guard on `submitStepOutput` so a double-click in autonomous mode can't fire two LM planning calls.
3. Add `managerLlm.test.ts` covering `tryParsePlannerJson` / `tryParseAnalysisJson` and a stub-model test for `runStepAutonomously`.
4. Per-ticket autonomous-mode counter so the user can see how many premium calls a fully autonomous ticket consumed.
5. Surface `lm-error` / `no-model` results as a sticky banner on the ticket card instead of a transient notification.
