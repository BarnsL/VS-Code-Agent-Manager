# Automation Model — Manual / Continuous / Autonomous / Parallel

VS Code Agent Manager v1.3.0 supports four orthogonal automation modes per
ticket. They can be combined freely. The combination of **Autonomous +
Continuous** drives a ticket end-to-end with no human paste.

## 1. Manual (default for new tickets)

- The user clicks **Run Next Step** to launch each agent.
- The agent runs in chat. The user pastes the chat response into the ticket
  card's output textarea.
- Clicking **Submit Output + Analyze** captures the output, runs manager
  analysis, marks the step done, and **stops**.
- The user reviews the analysis preview, then clicks **Run Next Step** again
  to launch the next agent.

Use this when each step is high-stakes and you want to inspect the chat
output yourself before the next agent sees it.

## 2. Continuous Mode (per ticket)

- Toggle the **Continuous mode** checkbox on the ticket card, or run
  **Copilot Agents: Toggle Ticket Continuous Mode**.
- The first step still has to be launched manually (so the original prompt
  reaches the chat with full intent).
- Every subsequent **Submit Output + Analyze** automatically launches the
  next agent with the prior output and analysis quoted verbatim.
- The workflow halts at the end of the queued steps, or when a step's output
  is empty (the manager refuses to advance without captured output).

Use this for repetitive multi-step pipelines where you trust the agent chain
and just want to keep pasting outputs in sequence.

## 3. Autonomous Mode (per ticket, v1.3.0)

- Toggle the **Autonomous mode** checkbox on the ticket card, or run
  **Copilot Agents: Toggle Ticket Autonomous Mode**.
- When ON, `launchTicketStep` skips Copilot Chat and instead calls
  `vscode.lm.sendRequest` directly with the agent's `.agent.md` body as the
  system message and the composed ticket query as the user message.
- The full streamed response is captured and routed back through
  `submitStepOutput`, so the LLM analyzer + LLM planner + hard output gate +
  continuous-mode chaining all behave identically to the manual-paste path.
- Combined with **Continuous mode**, a ticket runs end-to-end with no human
  paste until the planner reports `done` (or until an error is surfaced).

**Caveat:** the LM call bypasses chat-participant tools, so file edits,
terminal runs, and other side-effecting tools are NOT executed. Use
autonomous mode for analysis / planning / brainstorming / review steps; use
the chat-paste flow for steps that need real tool actions.

## 4. Parallel Lanes (per ticket, any number)

- Click **Spawn Parallel** on a ticket card, or run
  **Copilot Agents: Spawn Parallel Agent Lane**.
- Choose any agent and provide a side-chat prompt.
- The extension opens a new chat with that agent and records the lane on the
  ticket. The main timeline keeps running independently.
- Lane output is captured separately and does not gate the main timeline.

Use this when you want one agent triaging while another writes docs and a
third runs in the main lane \u2014 all in parallel chats, all visible from one
ticket card.

---

## Mode interaction matrix

| Main timeline | Lanes | Continuous Mode | Autonomous Mode | Effect |
|---|---|---|---|---|
| Manual | None | Off | Off | One step at a time, user-driven, chat-paste required |
| Manual | Many | Off | Off | User-driven main + parallel side chats |
| Continuous | None | On | Off | Self-driving main timeline, chat-paste required, gated on output capture |
| Continuous | Many | On | Off | Self-driving main + independent parallel lanes |
| Autonomous | None | Off | On | Each step runs via `vscode.lm`; output captured automatically; manager pauses for review between steps |
| Autonomous + Continuous | None/Many | On | On | Fully hands-off: ticket runs end-to-end through `vscode.lm` until planner reports `done` |

## Output gating safety

In every mode, the manager refuses to launch the next step until output has
been captured for the current step. The blind `while`-loop auto-drive from
v1.0.0 is gone. This is enforced in two places:

1. UI: the per-step output textarea is the only path to advance an active
   step. The queue button label becomes `Submit Output + Advance` whenever a
   step is in `active` or `awaiting-output`.
2. Logic: `shouldAutoProceedWorkflow({ hasCapturedOutput: false })` returns
   `false` regardless of the global auto-proceed setting.
