# VS Code Agent Manager

A native VS Code extension that turns your Copilot agent files into a fully managed, **manager-mediated** control center — with sequential output-gated handoffs, parallel side-chat lanes, on-the-fly agent reassignment, a live dashboard, premium usage tracking, multi-agent ticket workflows, and one-click `@route` orchestration.

> **v1.1.0 — Manager-Mediated Workflow.** The extension no longer fires chat queries blindly. Each step runs, you paste the chat output back into the ticket card, the manager analyzes it, and only then composes the next agent’s prompt with the prior output quoted verbatim. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/AUTOMATION-MODEL.md`](docs/AUTOMATION-MODEL.md).

---

## Features

### Agent Index
Automatically discovers every `.agent.md` file across your workspace, user prompts folder, extension-bundled agents, and common user directories — all in a single tree view sorted by source.

- **User agents** — global files in your VS Code user prompts folder  
- **Workspace agents** — per-repo `.github/agents/` files  
- **Extension agents** — agents contributed by installed extensions  
- Inline **Invoke in Chat**, **Copy @mention**, **Open File**, **Duplicate**, and **Delete** actions per agent

### Copilot Agent Manager Dashboard (Control Center)
A webview panel surfaced in the Copilot Agents activity-bar container that gives you a birds-eye view of every running agent workflow.

- **Ticket board** — kanban-style columns (New → Triaged → Working → Review → Blocked → Done)
- **Queued steps** — see which agent step is up next across all active tickets  
- **Activity feed** — every agent launch, ticket creation, and handoff in chronological order  
- **Usage meter** — real-time estimated premium request consumption with a progress bar

### Agent Activity (Left Sidebar)
A dedicated tree view in the same Copilot Agents activity-bar container shows what agents are doing right now, similar to operational sidebars in Amazon Q-style tooling.

- **Active Now** — currently running ticket step per agent, with one-click complete
- **Queued Next** — next queued step per ticket, with one-click run
- **Recent Agent Events** — latest launch and workflow events grouped by agent
- Each row is actionable so you can continue workflows without opening the dashboard first

### Premium Usage Tracking
Because GitHub does not expose live per-user Copilot premium balances to extensions, the extension tracks usage by counting agent launches and estimating token cost.

- Supports **Copilot Free** (50/mo), **Copilot Pro** (300/mo), **Copilot Pro+** (1500/mo), or a **Custom** quota  
- Seed your current baseline at any time via *Configure Copilot Usage Tracking* in the command palette  
- Quickly match the VS Code Copilot panel using *Sync Usage From Copilot Panel* (enter `% used`, e.g. `40%`)  
- Status bar shows `🤖 <agents>  🎫 <open tickets>  📊 <used>/<quota>` at a glance
- Status tooltip now includes explicit **Plan limit**, **Used**, **Remaining**, **Last updated**, and tracking-source note for clearer quota interpretation
- Usage is now recorded consistently from all launch entry points, including **Invoke in Chat** from Agent Index

### Multi-Agent Ticket Workflows (Manager-Mediated, v1.1.0)
Break complex tasks into ordered, agent-specific steps and let the manager broker each handoff with the actual chat output in hand.

- Create a ticket from any task description — the router suggests the best agent sequence
- One-click **Run Next Step** opens the correct agent in Copilot chat with a structured handoff prompt that quotes every prior step’s chat output verbatim
- Each ticket card has a **per-step output textarea**. Paste the agent’s response, click **Submit Output + Analyze**, and the manager:
  1. captures the raw output on the step
  2. extracts a structured analysis (key points, open questions, headline)
  3. composes the next prompt with both the raw output and the analysis embedded
- **Continuous Mode** per ticket — when on, submitting output auto-launches the next agent. When off, the manager pauses for your review between agents.
- **Spawn Parallel** opens a side-chat lane on a chosen agent that runs alongside the main timeline (great for multi-stream work across multiple chats)
- **Reassign Agent** on the active step swaps the assignee without restarting the workflow
- Step pipeline rendered on every ticket card showing each step’s status (queued / active / awaiting-output / done / blocked)
- Ticket status flows through: `new → triaged → working → review → done`
- The dashboard’s **Workflow Queue** surfaces each ticket’s current focus point so you can jump straight to the active textarea

### `@route` Chat Participant
Type `@route <task>` in Copilot Chat to instantly get a ranked list of agents for your task with confidence scores and reasoning. Sub-commands:

| Command | Description |
|---|---|
| `@route <task>` | Rank and suggest the best agents |
| `@route /list` | List all indexed agents grouped by source |
| `@route /ticket <task>` | Create a multi-agent ticket workflow from the chat |

### Task Router Command
**Copilot Agents: Route Task to Agent** in the command palette — paste any task, pick an agent from the ranked results, then launch immediately in chat or create a tracked ticket.

---

## Installation

### From VSIX (local install)
1. Clone or download this repository  
2. Run `npm install` then `npm run build` in the project root  
3. Run `npx vsce package` to produce a `.vsix` file  
4. In VS Code: **Extensions → … → Install from VSIX…** → select the generated `.vsix`

### Requirements
- VS Code **1.110.0** or later  
- GitHub Copilot (any plan) installed and signed in

---

## Usage

### Opening the Dashboard
- Click the **robot icon** in the activity bar → **Control Center**  
- Use the command palette: **Copilot Agents: Open Agent Manager Panel**  
- Click the status bar item in the lower-right corner

### Monitoring Agent Execution
- In the same activity bar container, open **Agent Activity** for a live operations list
- Use **Active Now** and **Queued Next** rows to run/complete ticket steps directly
- Use **Recent Agent Events** to open the relevant agent file quickly

### Creating a Ticket
1. Command palette → **Copilot Agents: Create Ticket Workflow**
2. Describe your task — the router picks agent assignments automatically
3. The dashboard opens with the new ticket in the board

### Running a Ticket Step (Manager-Mediated)
1. In the dashboard, click **Run Next Step** on any ticket
2. The agent prompt opens in Copilot Chat with full context, prior chat output, and the manager’s prior analysis
3. When the agent is done in chat, **paste its full response** into the ticket card’s output textarea and click **Submit Output + Analyze**
4. The manager extracts a structured analysis and either pauses for your review (default) or auto-launches the next agent (when **Continuous mode** is on for that ticket)
5. Use **Reassign Agent** on the active step to swap the assignee. Use **Spawn Parallel** to launch a side-chat lane that runs alongside the main timeline.

### Configuring Usage Tracking
Command palette → **Copilot Agents: Configure Copilot Usage Tracking**  
Select your plan and optionally seed the number of premium requests already used this month.

### Creating a New Agent
Command palette → **Copilot Agents: New Agent** → choose a template (Debugging, Planning, Implementation, Review, or Custom) → enter a name → choose a save location.

---

## Commands

| Command | Description |
|---|---|
| `Copilot Agents: Open Agent Manager Panel` | Reveal the dashboard in the activity bar |
| `Copilot Agents: New Agent` | Create a new `.agent.md` file from a template |
| `Copilot Agents: Open Agent File` | Jump to an agent file in the editor |
| `Copilot Agents: Invoke in Chat` | Open the selected agent in Copilot Chat |
| `Copilot Agents: Copy @mention` | Copy `@agentname` to the clipboard |
| `Copilot Agents: Route Task to Agent` | Rank agents for a described task |
| `Copilot Agents: Create Ticket Workflow` | Create a multi-step agent ticket |
| `Copilot Agents: Run Next Ticket Step` | Launch the next queued step in chat |
| `Copilot Agents: Complete Active Ticket Step` | Mark the current step done with a manual summary |
| `Copilot Agents: Submit Step Output to Manager` | Hand the agent’s chat output to the manager for analysis + advance |
| `Copilot Agents: Reassign Ticket Step Agent` | Swap the agent on the active or next queued step |
| `Copilot Agents: Spawn Parallel Agent Lane` | Start a side-chat lane on a chosen agent in parallel with the main workflow |
| `Copilot Agents: Toggle Ticket Continuous Mode` | Toggle whether submitted output auto-launches the next agent |
| `Copilot Agents: Advance Ticket (Manager-Mediated)` | Backwards-compatible single structured advance (replaces v1.0 Auto-Drive) |
| `Copilot Agents: Seed Required Feature Tickets` | Create roadmap tickets for auto-assignment, chat orchestration, and completion-driven lifecycle |
| `Copilot Agents: Configure Copilot Usage Tracking` | Set plan and seed baseline usage |
| `Copilot Agents: Sync Usage From Copilot Panel` | Seed usage from Copilot Quick Settings percent-used value |
| `Copilot Agents: Refresh Agents` | Re-scan all agent discovery paths |

---

## Product Roadmap Tickets

Use the command palette action **Copilot Agents: Seed Required Feature Tickets** to create a ready-to-run backlog in the dashboard ticket board.

This backlog explicitly covers:

- Automatic agent assignment for each new job
- Chat-first orchestration and structured handoffs
- Task ticket lifecycle that remains active until completion

Detailed external benchmarking and ticket definitions are documented in `docs/agent-orchestration-research-and-feature-tickets.md`.

---

## Agent Discovery Paths

The extension scans the following locations automatically:

| Source | Path |
|---|---|
| User Prompts | `%APPDATA%\Code\User\prompts` (Windows) / `~/.config/Code/User/prompts` (Linux/macOS) |
| Workspace | `.github/agents/*.agent.md` in each workspace folder |
| Extensions | `.agent.md` files bundled inside installed VS Code extensions |
| Extra user dirs | `~/.copilot/agents`, `~/.superpowers-copilot/agents` |

---

## Contributing

Pull requests and issues are welcome. To set up the development environment:

```bash
git clone https://github.com/BarnsL/VS-Code-Agent-Manager.git
cd VS-Code-Agent-Manager
npm install
npm run compile
```

Press **F5** in VS Code to open an Extension Development Host with the extension loaded.

---

## License

[MIT](LICENSE) — © 2026 VS Code Agent Manager Contributors
