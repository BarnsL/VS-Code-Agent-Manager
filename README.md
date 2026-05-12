# VS Code Agent Manager

A native VS Code extension that turns your Copilot agent files into a fully managed control center — with a live dashboard, premium usage tracking, multi-agent ticket workflows, and one-click `@route` orchestration.

![VS Code Agent Manager dashboard](https://raw.githubusercontent.com/BarnsL/VS-Code-Agent-Manager/main/media/dashboard-preview.png)

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

### Premium Usage Tracking
Because GitHub does not expose live per-user Copilot premium balances to extensions, the extension tracks usage by counting agent launches and estimating token cost.

- Supports **Copilot Free** (50/mo), **Copilot Pro** (300/mo), **Copilot Pro+** (1500/mo), or a **Custom** quota  
- Seed your current baseline at any time via *Configure Copilot Usage Tracking* in the command palette  
- Status bar shows `🤖 <agents>  🎫 <open tickets>  📊 <used>/<quota>` at a glance

### Multi-Agent Ticket Workflows
Break complex tasks into ordered, agent-specific steps and track them from creation through completion.

- Create a ticket from any task description — the router automatically suggests the best agent sequence  
- One-click **Run Step** opens the correct agent in Copilot chat with a structured handoff prompt  
- **Complete Step** captures a handoff summary that is passed to the next agent  
- Ticket status flows through: `new → triaged → working → review → done`

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

### Creating a Ticket
1. Command palette → **Copilot Agents: Create Ticket Workflow**  
2. Describe your task — the router picks agent assignments automatically  
3. The dashboard opens with the new ticket in the board

### Running a Ticket Step
1. In the dashboard, click **Run Step** on any queued ticket  
2. The correct agent prompt is opened in Copilot Chat with full context and prior handoffs  
3. When the agent is done, click **Complete** in the dashboard and add a one-line handoff summary

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
| `Copilot Agents: Complete Active Ticket Step` | Mark the current step done with a summary |
| `Copilot Agents: Configure Copilot Usage Tracking` | Set plan and seed baseline usage |
| `Copilot Agents: Refresh Agents` | Re-scan all agent discovery paths |

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
