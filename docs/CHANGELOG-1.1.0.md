# Release 1.1.0 — Auto-Drive, Step Pipeline, Persisted Plan Fix, and Wiring Restore

Date: 2026-05-12

This release makes tickets resolve and proceed on their own once auto-proceed
is enabled, fixes the side-panel premium display getting stuck on the previous
quota, and adds a per-ticket workflow step pipeline visualization inspired by
[`patoles/agent-flow`](https://github.com/patoles/agent-flow) and
[`appsoftwareltd/vscode-agent-kanban`](https://github.com/appsoftwareltd/vscode-agent-kanban). It also restores the Agent Activity tree and previously-declared commands so the installed view wiring matches the extension manifest again.

---

## What changed

### 1. `configureUsage` now always persists the chosen plan
Selecting **Copilot Pro+ (1500)** then dismissing either of the two seed
baseline prompts no longer aborts the flow. The seeds are optional; the new
plan, label, and quota are always saved and the side panel updates immediately.

- File: `src/extension.ts`
- Function: `configureUsage()`

### 2. New tickets auto-launch when auto-proceed is on
`createTicketFromPrompt()` now reads `opsStore.getWorkflowAutomation()` and, if
`autoProceedEnabled` is true, immediately calls `launchTicketStep(ticket.id)`
so the first agent is assigned and opened in chat without manual clicks.

- File: `src/extension.ts`
- Function: `createTicketFromPrompt()`

### 3. `Auto-Drive Ticket` command + per-card button
A new `copilot-agents.autoDriveTicket` command cycles a ticket through every
queued step. Each step is launched (chat opened with the handoff prompt) and
auto-completed with a synthesized handoff summary so the next agent picks up
immediately. An **Auto-Drive** button is rendered on every non-done /
non-blocked ticket card.

- Files: `src/extension.ts`, `src/dashboardView.ts`, `package.json`
- Symbols: `autoDriveTicket()`, `DashboardActions.autoDriveTicket`,
  command id `copilot-agents.autoDriveTicket`

### 4. Workflow step pipeline on ticket cards
Each ticket card now renders a numbered pill list of every step with status
coloring (queued / active / done / blocked). Hover for the full step title,
agent, and status.

- File: `src/dashboardView.ts`
- CSS classes: `.step-pipeline`, `.step-node`, `.step-active`,
  `.step-done`, `.step-blocked`

### 5. Wired previously-unwired dashboard actions
`autoDriveTicket` and `setAutoProceedWorkflow` were declared on
`DashboardActions` but never wired in `activate()`. They are now provided
when constructing `AgentDashboardViewProvider`. This also unblocked
TypeScript compilation.

- File: `src/extension.ts`

### 6. Restored Agent Activity and contributed command wiring
The `copilot-agents.activity` tree view now gets its data provider again, and
the contributed commands `copilot-agents.openAgentByName`,
`copilot-agents.seedRequiredFeatureTickets`, and
`copilot-agents.syncUsageFromCopilotPanel` are registered again so the shipped
manifest matches runtime behavior.

- File: `src/extension.ts`
- File: `src/activityView.ts`

---

## Verification

```powershell
cd copilot-task-router
npx tsc                                  # clean
node --test dist/workflowAutomation.test.js   # 4/4 pass
```

Manual smoke test:

1. Open the **Copilot Agents** view → **Configure Usage** → pick **Copilot Pro+** → press Esc on both seed prompts. Side panel must show **1500** quota.
2. Open the Workflow Queue panel, ensure **Auto-proceed** is checked.
3. Click **New Ticket**, give a description. The first agent should auto-open in chat.
4. On any open ticket card, click **Auto-Drive**. The ticket should move to **done** with handoff summaries on every step.
5. Confirm each ticket card shows a numbered pipeline of steps with the active one highlighted in blue and completed ones in green.

---

## Rollback (fully reversible)

The release includes source edits, matching generated `dist/` output, and the
release note in this file. To revert this release without losing other in-flight
changes, restore the affected tracked files and rebuild:

```powershell
cd copilot-task-router
git checkout HEAD -- `
  src/extension.ts `
  src/dashboardView.ts `
  package.json `
  README.md
npm run compile
```

If the changes are already committed, revert just this release commit:

```powershell
git log --oneline -- src/extension.ts src/dashboardView.ts | Select-Object -First 5
git revert <commit-sha-for-1.1.0>
npm run compile
```

To revert the deployed unpacked extension copy:

```powershell
$ext = "$env:USERPROFILE\.vscode\extensions\local.copilot-task-router-0.3.0"
Copy-Item -Path .\package.json -Destination $ext -Force
Copy-Item -Path .\dist\* -Destination "$ext\dist" -Force
code --command workbench.action.reloadWindow
```

To completely remove this release without git, manually undo:

| File | Change to undo |
|---|---|
| `src/extension.ts` | Remove the `autoDriveTicket()` function, the `copilot-agents.autoDriveTicket` command registration, the `autoDriveTicket` and `setAutoProceedWorkflow` entries on the `DashboardActions` literal, and the auto-launch block at the end of `createTicketFromPrompt()`. Restore the original `configureUsage()` early-return guards on the seed inputs. |
| `src/dashboardView.ts` | Remove `autoDriveTicket` from `DashboardActions`, the `case "autoDriveTicket"` branch, the `<ol class="step-pipeline">` block, the `Auto-Drive` button in ticket actions, and the `.step-pipeline` / `.step-node*` CSS rules. |
| `package.json` | Remove the `copilot-agents.autoDriveTicket` command entry. |
| `README.md` | Remove the new pipeline / Auto-Drive bullets and the Auto-Drive Ticket row in the commands table. |

No state schema migrations were introduced, so no `globalState` /
`workspaceState` cleanup is required when rolling back.

---

## Inspired by

- [`patoles/agent-flow`](https://github.com/patoles/agent-flow) — real-time agent step visualization
- [`appsoftwareltd/vscode-agent-kanban`](https://github.com/appsoftwareltd/vscode-agent-kanban) — kanban for agentic workflows
- [`shyamsridhar123/agentsmith-cli`](https://github.com/shyamsridhar123/agentsmith-cli) — handoff and sub-agent generation
