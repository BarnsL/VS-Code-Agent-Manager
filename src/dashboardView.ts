import * as vscode from "vscode";
import { DashboardSnapshot, TicketStatus, humanizeAgentName } from "./state";
import { getQueueActionLabel } from "./workflowAutomation";

const STATUS_COLUMNS: Array<{ status: TicketStatus; label: string }> = [
  { status: "new", label: "New" },
  { status: "triaged", label: "Triaged" },
  { status: "working", label: "Working" },
  { status: "review", label: "Review" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export interface DashboardActions {
  getSnapshot(): DashboardSnapshot;
  createTicket(): Thenable<void>;
  runTicketStep(ticketId: string, workflowResult?: string): Thenable<void>;
  completeTicketStep(ticketId: string, workflowResult?: string): Thenable<void>;
  /** v1.1.0 — capture chat output, run manager analysis, advance gated. */
  submitStepOutput(ticketId: string, output: string): Thenable<void>;
  /** v1.1.0 — swap the agent on a queued (or active) step. */
  reassignStepAgent(ticketId: string, stepId: string, agentName?: string): Thenable<void>;
  /** v1.1.0 — launch a side-chat lane that runs in parallel to the main timeline. */
  spawnParallelLane(ticketId: string, agentName?: string, prompt?: string): Thenable<void>;
  /** v1.1.0 — toggle whether submitted output auto-launches the next agent. */
  setContinuousMode(ticketId: string, enabled: boolean): Thenable<void>;
  /** v1.3.0 — toggle whether steps run autonomously through vscode.lm. */
  setAutonomousMode(ticketId: string, enabled: boolean): Thenable<void>;
  setAutoProceedWorkflow(enabled: boolean): Thenable<void>;
  /** v1.1.0 — list known agent names so reassignment / parallel pickers can render. */
  listAgents(): string[];
  configureUsage(): Thenable<void>;
  openAgent(agentName: string): Thenable<void>;
  copyMention(agentName: string): Thenable<void>;
  refresh(): Thenable<void> | void;
}

export class AgentDashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "copilot-agents.dashboard";

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: DashboardActions
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      const payload = message as {
        type?: string;
        ticketId?: string;
        stepId?: string;
        agentName?: string;
        workflowResult?: string;
        stepOutput?: string;
        enabled?: boolean;
      };

      switch (payload.type) {
        case "createTicket":
          await this.actions.createTicket();
          return;
        case "runTicketStep":
          if (payload.ticketId) {
            await this.actions.runTicketStep(payload.ticketId, payload.workflowResult);
          }
          return;
        case "completeTicketStep":
          if (payload.ticketId) {
            await this.actions.completeTicketStep(payload.ticketId, payload.workflowResult);
          }
          return;
        case "submitStepOutput":
          if (payload.ticketId && payload.stepOutput) {
            await this.actions.submitStepOutput(payload.ticketId, payload.stepOutput);
          }
          return;
        case "reassignStepAgent":
          if (payload.ticketId && payload.stepId) {
            await this.actions.reassignStepAgent(
              payload.ticketId,
              payload.stepId,
              payload.agentName
            );
          }
          return;
        case "spawnParallelLane":
          if (payload.ticketId) {
            await this.actions.spawnParallelLane(
              payload.ticketId,
              payload.agentName,
              payload.workflowResult
            );
          }
          return;
        case "setContinuousMode":
          if (payload.ticketId && typeof payload.enabled === "boolean") {
            await this.actions.setContinuousMode(payload.ticketId, payload.enabled);
          }
          return;
        case "setAutonomousMode":
          if (payload.ticketId && typeof payload.enabled === "boolean") {
            await this.actions.setAutonomousMode(payload.ticketId, payload.enabled);
          }
          return;
        case "setAutoProceedWorkflow":
          if (typeof payload.enabled === "boolean") {
            await this.actions.setAutoProceedWorkflow(payload.enabled);
          }
          return;
        case "configureUsage":
          await this.actions.configureUsage();
          return;
        case "openAgent":
          if (payload.agentName) await this.actions.openAgent(payload.agentName);
          return;
        case "copyMention":
          if (payload.agentName) await this.actions.copyMention(payload.agentName);
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

  refresh(snapshot?: DashboardSnapshot): void {
    if (!this.view) return;
    this.view.webview.html = this.renderHtml(
      this.view.webview,
      snapshot ?? this.actions.getSnapshot()
    );
  }

  private renderHtml(webview: vscode.Webview, snapshot: DashboardSnapshot): string {
    const nonce = getNonce();
    const progressWidth = `${snapshot.usage.percentUsed}%`;
    const queueMarkup = snapshot.queue.length
      ? snapshot.queue
          .map((item) => {
            const buttonLabel = getQueueActionLabel({
              status: item.status,
              autoProceedEnabled: snapshot.workflowAutomation.autoProceedEnabled,
            });
            // active / awaiting-output: jump straight to the per-step output
            // textarea on the ticket card; queued: launch the next step.
            const commandType =
              item.status === "queued" ? "runTicketStep" : "focusTicket";
            return `
              <article class="queue-item">
                <div>
                  <div class="queue-ticket">${escapeHtml(item.ticketTitle)}</div>
                  <div class="queue-step">${escapeHtml(item.stepTitle)} · @${escapeHtml(item.agentName)} · <em>${escapeHtml(item.status)}</em></div>
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
                    const awaitingStep = ticket.steps.find(
                      (step) => step.status === "awaiting-output"
                    );
                    const lastDoneStep = [...ticket.steps]
                      .reverse()
                      .find((step) => step.status === "done" && step.analysis);
                    const lanes = ticket.lanes ?? [];
                    const continuous = Boolean(ticket.continuousMode);
                    const autonomous = Boolean(ticket.autonomousMode);
                    const nextAgent = ticket.nextAgentName
                      ? `@${ticket.nextAgentName}`
                      : "Workflow complete";
                    const primaryAgent = ticket.recommendedAgents[0];
                    const stepFocus = activeStep ?? awaitingStep;
                    const stepFocusBlock = stepFocus
                      ? `
                        <div class="step-focus" id="focus-${escapeHtml(ticket.id)}">
                          <div class="step-focus-head">
                            <strong>${escapeHtml(stepFocus.title)}</strong>
                            <span class="pill">@${escapeHtml(stepFocus.agentName)}</span>
                            <span class="pill muted">${escapeHtml(stepFocus.status)}</span>
                          </div>
                          <textarea
                            class="step-output"
                            data-ticket-id="${escapeHtml(ticket.id)}"
                            placeholder="${autonomous ? "Autonomous mode is ON — the manager will run this step via the language model API and capture output automatically. Click 'Run Next Step' to start." : `Paste the agent's full chat output here. The manager will analyze it and ${continuous ? "auto-launch" : "prepare"} the next agent.`}"
                          >${escapeHtml(stepFocus.output ?? "")}</textarea>
                          <div class="step-focus-actions">
                            <button data-command="submitStepOutput" data-ticket-id="${escapeHtml(ticket.id)}">Submit Output + Analyze</button>
                            <button class="ghost" data-command="reassignStepAgent" data-ticket-id="${escapeHtml(ticket.id)}" data-step-id="${escapeHtml(stepFocus.id)}">Reassign Agent</button>
                          </div>
                        </div>
                      `
                      : "";
                    const lastAnalysisBlock = lastDoneStep?.analysis
                      ? `
                        <details class="manager-analysis">
                          <summary>Manager analysis \u2014 ${escapeHtml(lastDoneStep.title)} (@${escapeHtml(lastDoneStep.agentName)})</summary>
                          <pre>${escapeHtml(lastDoneStep.analysis)}</pre>
                        </details>
                      `
                      : "";
                    const lanesBlock = lanes.length
                      ? `
                        <div class="lanes">
                          <div class="lanes-head">Parallel lanes</div>
                          ${lanes
                            .map(
                              (lane) => `
                                <div class="lane">
                                  <span class="pill">@${escapeHtml(lane.agentName)}</span>
                                  <span class="lane-label">${escapeHtml(lane.label)}</span>
                                  <span class="pill muted">${escapeHtml(lane.status)}</span>
                                </div>
                              `
                            )
                            .join("")}
                        </div>
                      `
                      : "";
                    return `
                      <article class="ticket-card ticket-${status}">
                        <div class="ticket-topline">
                          <div class="ticket-title">${escapeHtml(ticket.title)}</div>
                          <span class="ticket-badge status-${status}">${label}</span>
                        </div>
                        <div class="ticket-prompt">${escapeHtml(ticket.prompt)}</div>
                        <ol class="step-pipeline">
                          ${ticket.steps
                            .map(
                              (step, index) => `
                                <li class="step-node step-${step.status}" title="${escapeHtml(step.title)} \u2022 @${escapeHtml(step.agentName)} \u2022 ${step.status}">
                                  <span class="step-index">${index + 1}</span>
                                  <span class="step-label">${escapeHtml(step.title)}</span>
                                </li>
                              `
                            )
                            .join("")}
                        </ol>
                        <div class="ticket-meta">
                          <span>${completed}/${ticket.steps.length} steps complete</span>
                          <span>${escapeHtml(nextAgent)}</span>
                        </div>
                        <label class="continuous-toggle">
                          <input type="checkbox" data-command="setContinuousMode" data-ticket-id="${escapeHtml(ticket.id)}" ${continuous ? "checked" : ""} />
                          Continuous mode (auto-launch next agent after each submitted output)
                        </label>
                        <label class="continuous-toggle">
                          <input type="checkbox" data-command="setAutonomousMode" data-ticket-id="${escapeHtml(ticket.id)}" ${autonomous ? "checked" : ""} />
                          Autonomous mode (run steps via language model API — no chat paste required)
                        </label>
                        ${stepFocusBlock}
                        ${lastAnalysisBlock}
                        ${lanesBlock}
                        <div class="ticket-pills">
                          ${ticket.recommendedAgents
                            .map(
                              (agentName) => `
                                <button class="pill" data-command="openAgent" data-agent-name="${escapeHtml(agentName)}">
                                  @${escapeHtml(agentName)}
                                </button>
                              `
                            )
                            .join("")}
                        </div>
                        <div class="ticket-actions">
                          <button data-command="runTicketStep" data-ticket-id="${escapeHtml(ticket.id)}">
                            ${stepFocus ? "Re-Open Active Step" : "Run Next Step"}
                          </button>
                          ${primaryAgent && !stepFocus
                            ? `<button class="ghost" data-command="copyMention" data-agent-name="${escapeHtml(primaryAgent)}">Copy Lead</button>`
                            : ""}
                          ${status !== "done"
                            ? `<button class="ghost" data-command="spawnParallelLane" data-ticket-id="${escapeHtml(ticket.id)}">Spawn Parallel</button>`
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

    .queue-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .workflow-result {
      width: 100%;
      min-height: 72px;
      border-radius: 10px;
      border: 1px solid var(--stroke);
      background: color-mix(in srgb, var(--surface-strong) 96%, transparent);
      color: var(--vscode-foreground);
      resize: vertical;
      padding: 10px;
      margin-bottom: 12px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      line-height: 1.45;
    }

    /* v1.1.0 \u2014 manager-mediated UI elements */
    .continuous-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      margin: 8px 0 4px;
      color: var(--vscode-descriptionForeground);
    }
    .step-focus {
      border: 1px dashed var(--stroke);
      border-radius: 10px;
      padding: 10px;
      margin: 6px 0 10px;
      background: color-mix(in srgb, var(--surface-strong) 92%, transparent);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .step-focus-head {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .step-output {
      width: 100%;
      min-height: 96px;
      border-radius: 8px;
      border: 1px solid var(--stroke);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      resize: vertical;
    }
    .step-focus-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .manager-analysis {
      margin: 6px 0;
      font-size: 11px;
    }
    .manager-analysis pre {
      white-space: pre-wrap;
      background: color-mix(in srgb, var(--surface-strong) 96%, transparent);
      border-radius: 6px;
      padding: 8px;
      margin-top: 4px;
    }
    .lanes {
      border-top: 1px solid var(--stroke);
      padding-top: 6px;
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .lanes-head {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
    }
    .lane {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 12px;
    }
    .lane-label { flex: 1; }
    .pill.muted { opacity: 0.7; }
    .step-awaiting-output { background: var(--vscode-editorWarning-foreground); }

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

    .step-pipeline {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      list-style: none;
      margin: 6px 0 4px;
      padding: 0;
    }

    .step-node {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid var(--stroke);
      background: var(--surface);
      color: var(--muted);
    }

    .step-node .step-index {
      font-weight: 700;
      opacity: 0.65;
    }

    .step-node.step-active {
      border-color: color-mix(in srgb, #1f8fff 70%, var(--stroke));
      color: var(--text);
      background: color-mix(in srgb, #1f8fff 18%, var(--surface));
    }

    .step-node.step-done {
      border-color: color-mix(in srgb, #3fb950 60%, var(--stroke));
      color: color-mix(in srgb, #3fb950 80%, var(--text));
    }

    .step-node.step-blocked {
      border-color: color-mix(in srgb, #f85149 60%, var(--stroke));
      color: color-mix(in srgb, #f85149 80%, var(--text));
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
        <p class="subtitle">${escapeHtml(snapshot.usage.planLabel)} · ${escapeHtml(humanizeAgentName(snapshot.usage.trackingMode))} tracking</p>
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
        ${snapshot.usage.dataSourceNote ? `<div class="usage-note">${escapeHtml(snapshot.usage.dataSourceNote)}</div>` : ""}
      </article>

      <article class="panel">
        <h2>Workflow Queue</h2>
        <p class="subtitle">The manager surfaces each ticket\u2019s active focus point. Open a ticket to paste its chat output and let the manager analyze + advance.</p>
        <label class="queue-toggle">
          <input type="checkbox" id="auto-proceed-toggle" ${snapshot.workflowAutomation.autoProceedEnabled ? "checked" : ""} />
          Default new tickets to continuous-mode (each ticket can still be toggled individually).
        </label>
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
    const autoProceedToggle = document.getElementById("auto-proceed-toggle");

    if (autoProceedToggle instanceof HTMLInputElement) {
      autoProceedToggle.addEventListener("change", () => {
        vscode.postMessage({
          type: "setAutoProceedWorkflow",
          enabled: autoProceedToggle.checked,
        });
      });
    }

    // Per-ticket continuous mode toggles. Sent eagerly on change so the
    // manager state stays in sync with the UI even if the user navigates
    // away mid-edit.
    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const cmd = target.dataset.command;
      if (cmd !== "setContinuousMode" && cmd !== "setAutonomousMode") return;
      const ticketId = target.dataset.ticketId;
      if (!ticketId) return;
      vscode.postMessage({
        type: cmd,
        ticketId,
        enabled: target.checked,
      });
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest("[data-command]");
      if (!(button instanceof HTMLElement)) {
        return;
      }

      // Continuous/autonomous-mode change events are handled by the change
      // listener above — click events here would fire as well and double-post.
      if (button.dataset.command === "setContinuousMode") return;
      if (button.dataset.command === "setAutonomousMode") return;

      const ticketId = button.dataset.ticketId;
      // Per-step output textarea lives next to the submit button inside the
      // ticket card, so we scope our lookup to the same card to avoid
      // forwarding output from a different ticket.
      let stepOutput;
      if (ticketId) {
        const card = button.closest(".ticket-card");
        const textarea = card ? card.querySelector('textarea.step-output[data-ticket-id="' + ticketId + '"]') : null;
        if (textarea instanceof HTMLTextAreaElement) {
          stepOutput = textarea.value;
        }
      }

      vscode.postMessage({
        type: button.dataset.command,
        ticketId,
        stepId: button.dataset.stepId,
        agentName: button.dataset.agentName,
        stepOutput,
        workflowResult: stepOutput,
      });
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}