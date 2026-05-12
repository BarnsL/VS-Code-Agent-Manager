"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentDashboardViewProvider = void 0;
const state_1 = require("./state");
const STATUS_COLUMNS = [
    { status: "new", label: "New" },
    { status: "triaged", label: "Triaged" },
    { status: "working", label: "Working" },
    { status: "review", label: "Review" },
    { status: "blocked", label: "Blocked" },
    { status: "done", label: "Done" },
];
class AgentDashboardViewProvider {
    extensionUri;
    actions;
    static viewType = "copilot-agents.dashboard";
    view;
    constructor(extensionUri, actions) {
        this.extensionUri = extensionUri;
        this.actions = actions;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.onDidReceiveMessage(async (message) => {
            const payload = message;
            switch (payload.type) {
                case "createTicket":
                    await this.actions.createTicket();
                    return;
                case "runTicketStep":
                    if (payload.ticketId)
                        await this.actions.runTicketStep(payload.ticketId);
                    return;
                case "completeTicketStep":
                    if (payload.ticketId)
                        await this.actions.completeTicketStep(payload.ticketId);
                    return;
                case "configureUsage":
                    await this.actions.configureUsage();
                    return;
                case "openAgent":
                    if (payload.agentName)
                        await this.actions.openAgent(payload.agentName);
                    return;
                case "copyMention":
                    if (payload.agentName)
                        await this.actions.copyMention(payload.agentName);
                    return;
                case "refresh":
                    await this.actions.refresh();
                    return;
                default:
                    return;
            }
        });
        this.refresh();
    }
    refresh(snapshot) {
        if (!this.view)
            return;
        this.view.webview.html = this.renderHtml(this.view.webview, snapshot ?? this.actions.getSnapshot());
    }
    renderHtml(webview, snapshot) {
        const nonce = getNonce();
        const progressWidth = `${snapshot.usage.percentUsed}%`;
        const queueMarkup = snapshot.queue.length
            ? snapshot.queue
                .map((item) => {
                const buttonLabel = item.status === "active" ? "Complete Step" : "Run Step";
                const commandType = item.status === "active" ? "completeTicketStep" : "runTicketStep";
                return `
              <article class="queue-item">
                <div>
                  <div class="queue-ticket">${escapeHtml(item.ticketTitle)}</div>
                  <div class="queue-step">${escapeHtml(item.stepTitle)} · @${escapeHtml(item.agentName)}</div>
                </div>
                <button class="ghost" data-command="${commandType}" data-ticket-id="${escapeHtml(item.ticketId)}">${buttonLabel}</button>
              </article>
            `;
            })
                .join("")
            : `<div class="empty-state">No queued ticket steps yet. Create a ticket to seed a multi-agent workflow.</div>`;
        const activityMarkup = snapshot.activity.length
            ? snapshot.activity
                .slice(0, 12)
                .map((event) => `
            <article class="activity-item">
              <div class="activity-meta">${formatTimestamp(event.timestamp)}</div>
              <div class="activity-message">${escapeHtml(event.message)}</div>
              ${event.agentName ? `<div class="pill muted">@${escapeHtml(event.agentName)}</div>` : ""}
            </article>
          `)
                .join("")
            : `<div class="empty-state">Agent activity will appear here after routing, ticket creation, and workflow launches.</div>`;
        const ticketColumnsMarkup = STATUS_COLUMNS.map(({ status, label }) => {
            const tickets = snapshot.tickets.filter((ticket) => ticket.status === status);
            return `
        <section class="ticket-column">
          <header class="column-header">
            <div>
              <h3>${label}</h3>
              <span>${tickets.length}</span>
            </div>
          </header>
          <div class="column-body">
            ${tickets.length
                ? tickets
                    .map((ticket) => {
                    const completed = ticket.steps.filter((step) => step.status === "done").length;
                    const activeStep = ticket.steps.find((step) => step.status === "active");
                    const nextAgent = ticket.nextAgentName
                        ? `@${ticket.nextAgentName}`
                        : "Workflow complete";
                    const primaryAgent = ticket.recommendedAgents[0];
                    return `
                      <article class="ticket-card ticket-${status}">
                        <div class="ticket-topline">
                          <div class="ticket-title">${escapeHtml(ticket.title)}</div>
                          <span class="ticket-badge status-${status}">${label}</span>
                        </div>
                        <div class="ticket-prompt">${escapeHtml(ticket.prompt)}</div>
                        <div class="ticket-meta">
                          <span>${completed}/${ticket.steps.length} steps complete</span>
                          <span>${escapeHtml(nextAgent)}</span>
                        </div>
                        <div class="ticket-pills">
                          ${ticket.recommendedAgents
                        .map((agentName) => `
                                <button class="pill" data-command="openAgent" data-agent-name="${escapeHtml(agentName)}">
                                  @${escapeHtml(agentName)}
                                </button>
                              `)
                        .join("")}
                        </div>
                        <div class="ticket-actions">
                          <button data-command="runTicketStep" data-ticket-id="${escapeHtml(ticket.id)}">
                            ${activeStep ? "Open Active Step" : "Run Next Step"}
                          </button>
                          ${activeStep
                        ? `<button class="ghost" data-command="completeTicketStep" data-ticket-id="${escapeHtml(ticket.id)}">Complete</button>`
                        : primaryAgent
                            ? `<button class="ghost" data-command="copyMention" data-agent-name="${escapeHtml(primaryAgent)}">Copy Lead</button>`
                            : ""}
                        </div>
                      </article>
                    `;
                })
                    .join("")
                : `<div class="empty-column">No tickets</div>`}
          </div>
        </section>
      `;
        }).join("");
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Copilot Agent Control Center</title>
  <style>
    :root {
      color-scheme: light dark;
      --surface: color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent);
      --surface-strong: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-sideBar-background));
      --stroke: color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
      --success: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
      --shadow: rgba(0, 0, 0, 0.22);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 18px;
      font-family: "Segoe UI Variable Text", "Aptos", "Segoe UI", sans-serif;
      color: var(--vscode-foreground);
      background:
        radial-gradient(circle at top left, rgba(30, 144, 255, 0.15), transparent 34%),
        radial-gradient(circle at top right, rgba(255, 166, 0, 0.14), transparent 28%),
        linear-gradient(180deg, color-mix(in srgb, var(--vscode-sideBar-background) 92%, transparent), var(--vscode-editor-background));
    }

    button {
      border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--stroke));
      background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--surface-strong) 94%, transparent));
      color: var(--vscode-button-foreground, var(--vscode-foreground));
      border-radius: 999px;
      cursor: pointer;
      padding: 7px 12px;
      font: inherit;
    }

    button.ghost {
      background: transparent;
      border-color: var(--stroke);
      color: var(--muted);
    }

    .shell {
      display: grid;
      gap: 16px;
    }

    .hero,
    .panel,
    .ticket-column {
      background: linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 92%, transparent), color-mix(in srgb, var(--surface) 96%, transparent));
      border: 1px solid var(--stroke);
      border-radius: 20px;
      box-shadow: 0 16px 32px -24px var(--shadow);
    }

    .hero {
      padding: 18px;
      display: grid;
      gap: 14px;
      background:
        linear-gradient(135deg, rgba(0, 122, 204, 0.24), rgba(255, 166, 0, 0.16)),
        linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 92%, transparent), color-mix(in srgb, var(--surface) 96%, transparent));
    }

    .eyebrow {
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--muted);
      font-size: 11px;
    }

    .hero h1 {
      margin: 2px 0 6px;
      font-size: 26px;
      line-height: 1.15;
    }

    .hero p:last-child,
    .hero .subline {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }

    .metric-card {
      padding: 14px;
      border-radius: 18px;
      border: 1px solid var(--stroke);
      background: linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 95%, transparent), color-mix(in srgb, var(--surface) 98%, transparent));
    }

    .metric-label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .metric-value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
    }

    .metric-detail {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .grid-two {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }

    .panel {
      padding: 16px;
    }

    .panel h2 {
      margin: 0 0 6px;
      font-size: 16px;
    }

    .panel .subtitle {
      margin: 0 0 14px;
      color: var(--muted);
      line-height: 1.45;
    }

    .usage-bar {
      position: relative;
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: color-mix(in srgb, var(--stroke) 78%, transparent);
      margin: 10px 0 14px;
    }

    .usage-bar > span {
      position: absolute;
      inset: 0 auto 0 0;
      width: ${progressWidth};
      background: linear-gradient(90deg, #1f8fff, #ffb347);
      border-radius: inherit;
    }

    .usage-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .usage-stats strong {
      display: block;
      font-size: 18px;
      margin-bottom: 4px;
    }

    .usage-note {
      padding: 10px 12px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--surface-strong) 96%, transparent);
      color: var(--muted);
      line-height: 1.45;
      border: 1px solid var(--stroke);
    }

    .queue-list,
    .activity-list {
      display: grid;
      gap: 10px;
    }

    .queue-item,
    .activity-item {
      display: grid;
      gap: 8px;
      padding: 12px;
      border-radius: 16px;
      border: 1px solid var(--stroke);
      background: color-mix(in srgb, var(--surface-strong) 96%, transparent);
    }

    .queue-item {
      grid-template-columns: 1fr auto;
      align-items: center;
    }

    .queue-ticket,
    .ticket-title {
      font-weight: 700;
      line-height: 1.3;
    }

    .queue-step,
    .activity-meta,
    .ticket-meta,
    .ticket-prompt,
    .empty-column,
    .empty-state {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .ticket-board {
      display: grid;
      gap: 16px;
    }

    .ticket-columns {
      display: grid;
      grid-template-columns: repeat(3, minmax(240px, 1fr));
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .ticket-column {
      min-height: 220px;
      padding: 14px;
    }

    .column-header div {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
    }

    .column-header h3 {
      margin: 0;
      font-size: 15px;
    }

    .column-header span {
      color: var(--muted);
      font-size: 12px;
    }

    .column-body {
      display: grid;
      gap: 10px;
    }

    .ticket-card {
      display: grid;
      gap: 10px;
      padding: 12px;
      border-radius: 16px;
      border: 1px solid var(--stroke);
      background: color-mix(in srgb, var(--surface-strong) 98%, transparent);
    }

    .ticket-topline,
    .ticket-meta,
    .ticket-actions {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .ticket-badge,
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      padding: 5px 10px;
      border: 1px solid var(--stroke);
      background: color-mix(in srgb, var(--surface) 98%, transparent);
      color: inherit;
      font-size: 11px;
    }

    .pill.muted {
      color: var(--muted);
    }

    .ticket-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .status-new { border-color: color-mix(in srgb, #6ea8fe 40%, var(--stroke)); }
    .status-triaged { border-color: color-mix(in srgb, #1f8fff 45%, var(--stroke)); }
    .status-working { border-color: color-mix(in srgb, #ffb347 45%, var(--stroke)); }
    .status-review { border-color: color-mix(in srgb, #d29922 50%, var(--stroke)); }
    .status-blocked { border-color: color-mix(in srgb, #f85149 55%, var(--stroke)); }
    .status-done { border-color: color-mix(in srgb, #3fb950 48%, var(--stroke)); }

    .ticket-new { box-shadow: inset 0 0 0 1px rgba(110, 168, 254, 0.08); }
    .ticket-triaged { box-shadow: inset 0 0 0 1px rgba(31, 143, 255, 0.08); }
    .ticket-working { box-shadow: inset 0 0 0 1px rgba(255, 179, 71, 0.08); }
    .ticket-review { box-shadow: inset 0 0 0 1px rgba(210, 153, 34, 0.08); }
    .ticket-blocked { box-shadow: inset 0 0 0 1px rgba(248, 81, 73, 0.08); }
    .ticket-done { box-shadow: inset 0 0 0 1px rgba(63, 185, 80, 0.08); }

    @media (max-width: 980px) {
      .ticket-columns {
        grid-template-columns: repeat(2, minmax(220px, 1fr));
      }
    }

    @media (max-width: 720px) {
      body {
        padding: 12px;
      }

      .ticket-columns {
        grid-template-columns: minmax(220px, 1fr);
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Copilot Agent Manager</p>
        <h1>Control Center</h1>
        <p class="subline">Route work, track premium usage, and move tickets through multi-agent handoffs from one native VS Code dashboard.</p>
      </div>
      <div class="hero-actions">
        <button data-command="createTicket">New Ticket</button>
        <button class="ghost" data-command="configureUsage">Configure Usage</button>
        <button class="ghost" data-command="refresh">Refresh</button>
      </div>
    </section>

    <section class="metrics">
      <article class="metric-card">
        <span class="metric-label">Agents</span>
        <div class="metric-value">${snapshot.agentCounts.total}</div>
        <div class="metric-detail">${snapshot.agentCounts.user} user · ${snapshot.agentCounts.workspace} workspace · ${snapshot.agentCounts.extension} extension</div>
      </article>
      <article class="metric-card">
        <span class="metric-label">Open Tickets</span>
        <div class="metric-value">${snapshot.ticketCounts.open}</div>
        <div class="metric-detail">${snapshot.ticketCounts.review} in review · ${snapshot.ticketCounts.blocked} blocked</div>
      </article>
      <article class="metric-card">
        <span class="metric-label">Queued Steps</span>
        <div class="metric-value">${snapshot.queue.length}</div>
        <div class="metric-detail">Systematic handoffs waiting to run</div>
      </article>
      <article class="metric-card">
        <span class="metric-label">Estimated Premium</span>
        <div class="metric-value">${snapshot.usage.remainingPremium}</div>
        <div class="metric-detail">${snapshot.usage.estimatedUsedPremium}/${snapshot.usage.monthlyQuota} consumed</div>
      </article>
    </section>

    <section class="grid-two">
      <article class="panel">
        <h2>Copilot Usage</h2>
        <p class="subtitle">${escapeHtml(snapshot.usage.planLabel)} · ${escapeHtml((0, state_1.humanizeAgentName)(snapshot.usage.trackingMode))} tracking</p>
        <div class="usage-bar"><span></span></div>
        <div class="usage-stats">
          <div>
            <strong>${snapshot.usage.remainingPremium}</strong>
            <span class="ticket-meta">remaining premium requests</span>
          </div>
          <div>
            <strong>${snapshot.usage.estimatedTokenUnits}</strong>
            <span class="ticket-meta">estimated prompt tokens</span>
          </div>
        </div>
        <div class="usage-note">${escapeHtml(snapshot.usage.dataSourceNote)}</div>
      </article>

      <article class="panel">
        <h2>Workflow Queue</h2>
        <p class="subtitle">Start the next queued agent or complete the active handoff to move work across agents.</p>
        <div class="queue-list">${queueMarkup}</div>
      </article>
    </section>

    <section class="panel ticket-board">
      <div>
        <h2>Ticket Board</h2>
        <p class="subtitle">Every ticket keeps its own agent chain, handoff summaries, and next recommended step.</p>
      </div>
      <div class="ticket-columns">${ticketColumnsMarkup}</div>
    </section>

    <section class="panel">
      <h2>Recent Activity</h2>
      <p class="subtitle">Creation, routing, workflow launches, and usage updates are logged here.</p>
      <div class="activity-list">${activityMarkup}</div>
    </section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest("[data-command]");
      if (!(button instanceof HTMLElement)) {
        return;
      }

      vscode.postMessage({
        type: button.dataset.command,
        ticketId: button.dataset.ticketId,
        agentName: button.dataset.agentName,
      });
    });
  </script>
</body>
</html>`;
    }
}
exports.AgentDashboardViewProvider = AgentDashboardViewProvider;
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function getNonce() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
//# sourceMappingURL=dashboardView.js.map