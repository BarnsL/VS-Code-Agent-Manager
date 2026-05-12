import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { AgentInfo, AgentSource, USER_PROMPTS_DIR, discoverAllAgents, routeTask } from "./agents";
import { AgentTreeProvider, AgentLeafItem } from "./treeView";
import { AgentDashboardViewProvider } from "./dashboardView";
import { AgentActivityProvider } from "./activityView";
import { AgentOpsStore, AgentTicket, DashboardSnapshot, WorkflowStep, deriveTitleFromPrompt } from "./state";
import { REQUIRED_FEATURE_TICKETS } from "./roadmap";

// ─── Agent Creation Templates ─────────────────────────────────────────────────

const TEMPLATES: Record<string, (name: string) => string> = {
  debugging: (name) =>
    `---
description: "Use when debugging ${name.replace(/-/g, " ")} errors, failures, or unexpected behavior"
model: inherit
tools:
  - read_file
  - grep_search
  - get_errors
  - run_in_terminal
---

# ${name}

## Overview

Describe what this debugging agent specializes in diagnosing.

## When to Use

- Errors of type X occur
- Tests in system Y fail
- Output doesn't match expected behavior

## Process

1. Identify the error signal
2. Reproduce the issue
3. Trace to root cause
4. Propose minimal fix
5. Verify fix doesn't introduce regressions
`,

  planning: (name) =>
    `---
description: "Use when planning or designing ${name.replace(/-/g, " ")} before writing code"
model: inherit
tools:
  - read_file
  - semantic_search
  - file_search
---

# ${name}

## Overview

Describe what this planning agent helps design or architect.

## When to Use

- Before starting a new feature
- When requirements are vague or ambiguous

## Process

1. Gather and clarify requirements
2. Identify constraints and tradeoffs
3. Propose design options
4. Recommend best option with rationale
5. Write a clear implementation spec
`,

  implementation: (name) =>
    `---
description: "Use when implementing ${name.replace(/-/g, " ")} with a clear spec or plan"
model: inherit
tools:
  - read_file
  - replace_string_in_file
  - create_file
  - run_in_terminal
  - get_errors
---

# ${name}

## Overview

Describe what this implementation agent builds.

## When to Use

- A spec or plan already exists
- Requirements are clearly defined

## Process

1. Read and understand the spec
2. Write failing tests first
3. Implement to make tests pass
4. Refactor for clarity
5. Verify all tests pass
`,

  review: (name) =>
    `---
description: "Use when reviewing code or handling review feedback for ${name.replace(/-/g, " ")}"
model: inherit
tools:
  - read_file
  - semantic_search
  - get_errors
---

# ${name}

## Overview

Describe what this review agent evaluates or improves.

## When to Use

- Receiving code review feedback
- Before submitting code for review

## Process

1. Read the code and review comments
2. Assess validity of each comment
3. Propose specific improvements
4. Verify changes satisfy reviewer intent
`,

  custom: (name) =>
    `---
description: "Use when ..."
model: inherit
tools:
  - read_file
  - grep_search
  - run_in_terminal
---

# ${name}

## Overview

Describe this agent's purpose.

## When to Use

- Condition 1
- Condition 2

## Process

1. Step one
2. Step two
3. Step three
`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AGENT_MANAGER_CONTAINER_ID = "copilot-agents";
const AGENT_MANAGER_DASHBOARD_VIEW_ID = "copilot-agents.dashboard";

function updateStatusBar(item: vscode.StatusBarItem, snapshot: DashboardSnapshot): void {
  const used = formatUsageValue(snapshot.usage.estimatedUsedPremium);
  const quota = formatUsageValue(snapshot.usage.monthlyQuota);
  const remaining = formatUsageValue(snapshot.usage.remainingPremium);
  item.text = `$(robot) ${snapshot.agentCounts.total}  $(issues) ${snapshot.ticketCounts.open}  $(graph) ${used}/${quota}`;
  item.tooltip = [
    `Copilot Agent Manager`,
    `${snapshot.agentCounts.total} indexed agents`,
    `${snapshot.ticketCounts.open} open tickets`,
    `Plan: ${snapshot.usage.planLabel} (${quota} monthly premium limit)`,
    `Used: ${used} estimated premium`,
    `Remaining: ${remaining} (${snapshot.usage.trackingMode} tracking)`,
    snapshot.usage.lastUpdatedAt
      ? `Updated: ${new Date(snapshot.usage.lastUpdatedAt).toLocaleString()}`
      : `Updated: not yet tracked`,
    snapshot.usage.dataSourceNote,
  ].join("\n");
}

function formatUsageValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getWorkspaceLabel(): string {
  const names = vscode.workspace.workspaceFolders?.map((folder) => folder.name) ?? [];
  return names.length > 0 ? names.join(", ") : "Workspace";
}

async function openChatQuery(query: string, fallbackMessage: string): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query });
  } catch {
    await vscode.env.clipboard.writeText(query);
    await vscode.commands.executeCommand("workbench.action.chat.open");
    vscode.window.showInformationMessage(fallbackMessage);
  }
}

async function focusAgentManager(): Promise<void> {
  // Reveal the contributed container explicitly. Relying only on the generated
  // `<viewId>.focus` command can fail when the container has not been shown yet.
  await vscode.commands.executeCommand(
    `workbench.view.extension.${AGENT_MANAGER_CONTAINER_ID}`
  );

  try {
    await vscode.commands.executeCommand(
      `${AGENT_MANAGER_DASHBOARD_VIEW_ID}.focus`
    );
  } catch {
    // The container is already visible; focusing the dashboard view is best-effort.
  }
}

function buildTicketQuery(ticket: AgentTicket, step: WorkflowStep): string {
  const handoffs = ticket.steps
    .filter((candidate) => candidate.status === "done" && candidate.summary)
    .map(
      (candidate) =>
        `- ${candidate.title} (@${candidate.agentName}): ${candidate.summary}`
    )
    .join("\n");

  return [
    `@${step.agentName}`,
    `Ticket: ${ticket.title}`,
    `Workspace: ${ticket.workspaceLabel}`,
    `Original request: ${ticket.prompt}`,
    handoffs ? `Prior handoffs:\n${handoffs}` : "No prior handoffs yet.",
    `Current step: ${step.title}`,
    `At the end, provide a concise handoff summary for the next agent or verifier.`,
  ].join("\n\n");
}

function pickTicketLabel(ticket: AgentTicket): string {
  const next = ticket.nextAgentName ? `@${ticket.nextAgentName}` : "complete";
  return `${ticket.title} · ${ticket.status} · ${next}`;
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // ── Tree Provider & View ────────────────────────────────────────────────────
  const tree = new AgentTreeProvider();
  const opsStore = new AgentOpsStore(context);

  const snapshotFor = (): DashboardSnapshot => opsStore.getSnapshot(tree.getAll());
  const activityProvider = new AgentActivityProvider(snapshotFor);

  const dashboard = new AgentDashboardViewProvider(context.extensionUri, {
    getSnapshot: snapshotFor,
    createTicket: async () => {
      await vscode.commands.executeCommand("copilot-agents.newTicket");
    },
    runTicketStep: async (ticketId) => {
      await vscode.commands.executeCommand("copilot-agents.runTicketStep", ticketId);
    },
    completeTicketStep: async (ticketId) => {
      await vscode.commands.executeCommand("copilot-agents.completeTicketStep", ticketId);
    },
    configureUsage: async () => {
      await vscode.commands.executeCommand("copilot-agents.configureUsage");
    },
    openAgent: async (agentName) => {
      const agent = tree.byName(agentName);
      if (agent) {
        await vscode.commands.executeCommand("copilot-agents.openAgent", agent);
      }
    },
    copyMention: async (agentName) => {
      await vscode.env.clipboard.writeText(`@${agentName}`);
      vscode.window.showInformationMessage(`Copied @${agentName}`);
    },
    refresh: async () => {
      refreshAll();
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AgentDashboardViewProvider.viewType,
      dashboard,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const treeView = vscode.window.createTreeView("copilot-agents.list", {
    treeDataProvider: tree,
    showCollapseAll: true,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

  const activityTreeView = vscode.window.createTreeView("copilot-agents.activity", {
    treeDataProvider: activityProvider,
    showCollapseAll: true,
    canSelectMany: false,
  });
  context.subscriptions.push(activityTreeView);

  // ── Status Bar ──────────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = "copilot-agents.focus";
  updateStatusBar(statusBar, snapshotFor());
  statusBar.show();
  context.subscriptions.push(statusBar);

  const refreshAll = () => {
    tree.refresh();
    const snapshot = snapshotFor();
    updateStatusBar(statusBar, snapshot);
    activityProvider.refresh(snapshot);
    dashboard.refresh(snapshot);
  };

  async function pickTicket(filter?: (ticket: AgentTicket) => boolean): Promise<AgentTicket | undefined> {
    const tickets = opsStore.getTickets().filter((ticket) => (filter ? filter(ticket) : true));
    if (tickets.length === 0) return undefined;
    if (tickets.length === 1) return tickets[0];

    const choice = await vscode.window.showQuickPick(
      tickets.map((ticket) => ({
        label: ticket.title,
        description: ticket.status,
        detail: pickTicketLabel(ticket),
        ticketId: ticket.id,
      })),
      { placeHolder: "Select a ticket" }
    );

    return choice ? opsStore.findTicket(choice.ticketId) : undefined;
  }

  async function promptForTicket(): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: "Describe the work to route into a multi-agent ticket",
      placeHolder: "e.g. build a Copilot dashboard with usage tracking and coordinated ticket handoffs",
      validateInput: (value) => value.trim() ? null : "A ticket needs a task description",
    });
  }

  async function createTicketFromPrompt(prompt: string): Promise<AgentTicket> {
    const ticket = await opsStore.createTicket({
      title: deriveTitleFromPrompt(prompt),
      prompt,
      routeResults: routeTask(prompt),
      workspaceLabel: getWorkspaceLabel(),
    });
    refreshAll();
    await focusAgentManager();
    vscode.window.showInformationMessage(
      `Created ticket: ${ticket.title} (${ticket.recommendedAgents.map((name) => `@${name}`).join(", ")})`
    );
    return ticket;
  }

  async function seedRequiredFeatureTickets(): Promise<void> {
    const existing = new Set(
      opsStore
        .getTickets()
        .map((ticket) => ticket.title.trim().toLowerCase())
    );

    let createdCount = 0;
    let skippedCount = 0;
    for (const spec of REQUIRED_FEATURE_TICKETS) {
      const normalizedTitle = spec.title.trim().toLowerCase();
      if (existing.has(normalizedTitle)) {
        skippedCount += 1;
        continue;
      }

      await opsStore.createTicket({
        title: spec.title,
        prompt: spec.prompt,
        routeResults: routeTask(spec.prompt),
        workspaceLabel: getWorkspaceLabel(),
      });
      existing.add(normalizedTitle);
      createdCount += 1;
    }

    refreshAll();
    await focusAgentManager();
    vscode.window.showInformationMessage(
      `Feature roadmap tickets: ${createdCount} created, ${skippedCount} skipped (already existed).`
    );
  }

  async function configureUsage(): Promise<void> {
    const presets = [
      { label: "Copilot Free", quota: 50, id: "free" },
      { label: "Copilot Pro", quota: 300, id: "pro" },
      { label: "Copilot Pro+", quota: 1500, id: "pro+" },
      { label: "Custom", quota: 0, id: "custom" },
    ];
    const preset = await vscode.window.showQuickPick(
      presets.map((item) => ({
        label: item.label,
        detail: item.quota > 0 ? `${item.quota} premium requests / month` : "Set a custom monthly quota",
        id: item.id,
        quota: item.quota,
      })),
      { placeHolder: "Choose your Copilot plan for estimated tracking" }
    );
    if (!preset) return;

    let quota = preset.quota;
    if (preset.id === "custom") {
      const customQuota = await vscode.window.showInputBox({
        prompt: "Monthly premium request budget",
        placeHolder: "300",
        validateInput: (value) => {
          const parsed = Number(value.trim());
          return Number.isFinite(parsed) && parsed >= 0 ? null : "Enter a non-negative number";
        },
      });
      if (!customQuota) return;
      quota = Number(customQuota.trim());
    }

    const current = opsStore.getUsage();
    const baselineUsedInput = await vscode.window.showInputBox({
      prompt: "Seed current premium requests already used",
      placeHolder: String(current.estimatedUsedPremium),
      value: String(current.estimatedUsedPremium),
      validateInput: (value) => {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) && parsed >= 0 ? null : "Enter a non-negative number";
      },
    });
    if (!baselineUsedInput) return;

    const baselineTokensInput = await vscode.window.showInputBox({
      prompt: "Seed estimated prompt tokens already used",
      placeHolder: String(current.estimatedTokenUnits),
      value: String(current.estimatedTokenUnits),
      validateInput: (value) => {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) && parsed >= 0 ? null : "Enter a non-negative number";
      },
    });
    if (!baselineTokensInput) return;

    await opsStore.configureUsage({
      planId: preset.id,
      planLabel: preset.label,
      monthlyQuota: quota,
      trackingMode: "estimated",
      baselinePremiumUsed: Number(baselineUsedInput.trim()),
      baselineTokens: Number(baselineTokensInput.trim()),
    });
    refreshAll();
  }

  async function launchTicketStep(ticketId: string): Promise<void> {
    const started = await opsStore.beginNextStep(ticketId);
    if (!started) {
      vscode.window.showInformationMessage("That ticket has no queued steps.");
      return;
    }

    const agent = tree.byName(started.step.agentName);
    const query = buildTicketQuery(started.ticket, started.step);
    await openChatQuery(
      query,
      `Ticket step copied to clipboard for @${started.step.agentName}`
    );
    await opsStore.recordAgentLaunch({
      agentName: started.step.agentName,
      model: agent?.model ?? "inherit",
      promptText: query,
      source: "ticket-workflow",
      ticketId: started.ticket.id,
    });
    refreshAll();
  }

  async function completeTicketStep(ticketId: string): Promise<void> {
    const ticket = opsStore.findTicket(ticketId);
    if (!ticket) {
      vscode.window.showInformationMessage("Ticket not found.");
      return;
    }

    const active = ticket.steps.find((step) => step.status === "active");
    if (!active) {
      vscode.window.showInformationMessage("No active step is running for that ticket.");
      return;
    }

    const summary = await vscode.window.showInputBox({
      prompt: `Handoff summary for ${active.title} (@${active.agentName})`,
      placeHolder: "Summarize what changed, what remains, and what the next agent should verify.",
      validateInput: (value) => value.trim() ? null : "A handoff summary keeps the next agent aligned",
    });
    if (!summary) return;

    await opsStore.completeActiveStep(ticket.id, summary);
    refreshAll();
  }

  // ── File Watcher ────────────────────────────────────────────────────────────
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.agent.md");
  watcher.onDidCreate(refreshAll);
  watcher.onDidChange(refreshAll);
  watcher.onDidDelete(refreshAll);
  context.subscriptions.push(watcher);

  // ── Command: Refresh ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.refresh", () => {
      refreshAll();
      vscode.window.showInformationMessage(
        `Agent Manager: ${snapshotFor().agentCounts.total} agents indexed`
      );
    })
  );

  // ── Command: Focus Panel ────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.focus", async () => {
      await focusAgentManager();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.newTicket", async () => {
      const prompt = await promptForTicket();
      if (!prompt) return;
      await createTicketFromPrompt(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.seedRequiredFeatureTickets", async () => {
      await seedRequiredFeatureTickets();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.runTicketStep", async (ticketId?: string) => {
      const ticket = ticketId
        ? opsStore.findTicket(ticketId)
        : await pickTicket((candidate) => candidate.status !== "done" && candidate.status !== "blocked");
      if (!ticket) return;
      await launchTicketStep(ticket.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.completeTicketStep", async (ticketId?: string) => {
      const ticket = ticketId
        ? opsStore.findTicket(ticketId)
        : await pickTicket((candidate) => candidate.steps.some((step) => step.status === "active"));
      if (!ticket) return;
      await completeTicketStep(ticket.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.configureUsage", async () => {
      await configureUsage();
    })
  );

  // ── Command: Open Agent File ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilot-agents.openAgent",
      async (item: AgentInfo | AgentLeafItem | undefined) => {
        let filePath: string | undefined;
        if (!item) {
          const agents = tree.getAll();
          const pick = await vscode.window.showQuickPick(
            agents.map((a) => ({
              label: `@${a.name}`,
              detail: a.description,
              description: a.source,
              filePath: a.filePath,
            })),
            { placeHolder: "Select an agent to open" }
          );
          filePath = pick?.filePath;
        } else {
          filePath =
            item instanceof AgentLeafItem ? item.agent.filePath : item.filePath;
        }
        if (!filePath) return;
        const doc = await vscode.workspace.openTextDocument(filePath);
        vscode.window.showTextDocument(doc);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.openAgentByName", async (agentName: string) => {
      const agent = tree.byName(agentName);
      if (!agent) {
        vscode.window.showInformationMessage(`Agent not found: @${agentName}`);
        return;
      }
      await vscode.commands.executeCommand("copilot-agents.openAgent", agent);
    })
  );

  // ── Command: Invoke in Chat ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilot-agents.invokeAgent",
      async (item: AgentLeafItem) => {
        const agent = item?.agent;
        if (!agent) return;
        const mention = `@${agent.name} `;
        await openChatQuery(mention, `@${agent.name} copied to clipboard — paste in chat`);
        // Keep premium telemetry consistent across every agent launch entry point.
        await opsStore.recordAgentLaunch({
          agentName: agent.name,
          model: agent.model,
          promptText: mention,
          source: "invoke-agent-command",
        });
        await opsStore.recordEvent({
          type: "agent-invoked",
          message: `Opened chat for @${agent.name}`,
          agentName: agent.name,
        });
        refreshAll();
      }
    )
  );

  // ── Command: Copy @mention ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilot-agents.copyMention",
      (item: AgentLeafItem) => {
        const agent = item?.agent;
        if (!agent) return;
        vscode.env.clipboard.writeText(`@${agent.name}`);
        vscode.window.showInformationMessage(`Copied @${agent.name}`);
      }
    )
  );

  // ── Command: Delete Agent ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilot-agents.deleteAgent",
      async (item: AgentLeafItem) => {
        const agent = item?.agent;
        if (!agent || agent.readonly) return;
        const confirm = await vscode.window.showWarningMessage(
          `Delete @${agent.name}? This cannot be undone.`,
          { modal: true },
          "Delete"
        );
        if (confirm !== "Delete") return;
        try {
          fs.unlinkSync(agent.filePath);
          void opsStore.recordEvent({
            type: "agent-deleted",
            message: `Deleted @${agent.name}`,
            agentName: agent.name,
          });
          refreshAll();
          vscode.window.showInformationMessage(`Deleted @${agent.name}`);
        } catch (e) {
          vscode.window.showErrorMessage(`Delete failed: ${e}`);
        }
      }
    )
  );

  // ── Command: Duplicate to User Agents ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "copilot-agents.duplicateToUser",
      async (item: AgentLeafItem) => {
        const agent = item?.agent;
        if (!agent) return;
        const dest = path.join(USER_PROMPTS_DIR, `${agent.name}.agent.md`);
        if (fs.existsSync(dest)) {
          const ok = await vscode.window.showWarningMessage(
            `@${agent.name} already exists in User Agents. Overwrite?`,
            { modal: true },
            "Overwrite"
          );
          if (ok !== "Overwrite") return;
        }
        try {
          ensureDir(USER_PROMPTS_DIR);
          fs.copyFileSync(agent.filePath, dest);
          await opsStore.recordEvent({
            type: "agent-duplicated",
            message: `Duplicated @${agent.name} into User Agents`,
            agentName: agent.name,
          });
          refreshAll();
          const open = await vscode.window.showInformationMessage(
            `Duplicated @${agent.name} to User Agents`,
            "Open"
          );
          if (open === "Open") {
            const doc = await vscode.workspace.openTextDocument(dest);
            vscode.window.showTextDocument(doc);
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Duplicate failed: ${e}`);
        }
      }
    )
  );

  // ── Command: New Agent ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.newAgent", async () => {
      const tplPick = await vscode.window.showQuickPick(
        [
          { label: "$(bug) Debugging", detail: "Root-cause errors and test failures", id: "debugging" },
          { label: "$(list-ordered) Planning", detail: "Plans, specs, architecture", id: "planning" },
          { label: "$(code) Implementation", detail: "Build features from a spec", id: "implementation" },
          { label: "$(eye) Review", detail: "Handle code review feedback", id: "review" },
          { label: "$(file-add) Custom", detail: "Blank — define your own", id: "custom" },
        ],
        { placeHolder: "Select a template" }
      );
      if (!tplPick) return;

      const nameInput = await vscode.window.showInputBox({
        prompt: "Agent name (kebab-case, e.g. my-code-reviewer)",
        placeHolder: "my-agent-name",
        validateInput: (v) => {
          if (!v.trim()) return "Name is required";
          if (!/^[a-z0-9-]+$/.test(v.trim()))
            return "Lowercase letters, numbers, and hyphens only";
          if (tree.byName(v.trim())) return `@${v.trim()} already exists`;
          return null;
        },
      });
      if (!nameInput) return;
      const agentName = nameInput.trim();

      const locationOptions = [
        {
          label: "$(person) User Agents",
          detail: "Available in all VS Code workspaces",
          dir: USER_PROMPTS_DIR,
        },
        ...(vscode.workspace.workspaceFolders?.map((f) => ({
          label: `$(folder) Workspace: ${f.name}`,
          detail: `${f.name}/.github/agents/`,
          dir: path.join(f.uri.fsPath, ".github", "agents"),
        })) ?? []),
      ];

      const locPick = await vscode.window.showQuickPick(locationOptions, {
        placeHolder: "Where should the agent be created?",
      });
      if (!locPick) return;

      const destPath = path.join(locPick.dir, `${agentName}.agent.md`);
      ensureDir(locPick.dir);
      fs.writeFileSync(destPath, TEMPLATES[tplPick.id](agentName), "utf-8");
      await opsStore.recordEvent({
        type: "agent-created",
        message: `Created @${agentName}`,
        agentName,
      });
      refreshAll();

      const doc = await vscode.workspace.openTextDocument(destPath);
      vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`Created @${agentName}`);
    })
  );

  // ── Command: Route Task (command palette) ───────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("copilot-agents.routeTask", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Describe your task — I'll recommend the best agent",
        placeHolder: "e.g. my tests are failing after the refactor",
      });
      if (!input) return;

      const results = routeTask(input);
      const agents = tree.getAll();
      const items = results.map((r) => {
        const meta = agents.find((a) => a.name === r.agentName);
        return {
          label: `$(robot) @${r.agentName}`,
          detail: meta?.description ?? "",
          description: `${r.confidence.toUpperCase()} — ${r.reason}`,
          agentName: r.agentName,
        };
      });

      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: `Best match: @${results[0]?.agentName ?? "brainstorming"}`,
      });
      if (!choice) return;

      const action = await vscode.window.showQuickPick(
        [
          { label: "Open in Chat", detail: "Launch the selected agent immediately", id: "chat" },
          { label: "Create Ticket Workflow", detail: "Open a tracked, multi-agent ticket in the dashboard", id: "ticket" },
        ],
        { placeHolder: "How should Agent Manager handle this task?" }
      );
      if (!action) return;

      if (action.id === "ticket") {
        await createTicketFromPrompt(input);
      } else {
        const query = `@${choice.agentName} ${input}`;
        await openChatQuery(query, "Query copied — paste in chat");
        const agent = tree.byName(choice.agentName);
        await opsStore.recordAgentLaunch({
          agentName: choice.agentName,
          model: agent?.model ?? "inherit",
          promptText: input,
          source: "route-command",
        });
        refreshAll();
      }
    })
  );

  // ── Chat Participant: @route ────────────────────────────────────────────────
  const participant = vscode.chat.createChatParticipant(
    "copilot-task-router.route",
    async (
      request: vscode.ChatRequest,
      _context: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const agents = tree.getAll();

      if (request.command === "ticket") {
        if (!request.prompt.trim()) {
          stream.markdown("Use `@route /ticket <task>` to create a tracked multi-agent workflow ticket.");
          return;
        }

        const ticket = await opsStore.createTicket({
          title: deriveTitleFromPrompt(request.prompt),
          prompt: request.prompt,
          routeResults: routeTask(request.prompt),
          workspaceLabel: getWorkspaceLabel(),
        });
        refreshAll();
        stream.markdown(`## Created Ticket\n\n`);
        stream.markdown(`**${ticket.title}**\n\n`);
        stream.markdown(`Lead agents: ${ticket.recommendedAgents.map((name) => `\`@${name}\``).join(", ")}\n\n`);
        stream.markdown(`Next step: \`${ticket.steps[0]?.title ?? "Queued"}\` with \`@${ticket.steps[0]?.agentName ?? "brainstorming"}\`\n\n`);
        stream.markdown(`Open the **Control Center** view to run the workflow.`);
        return;
      }

      if (request.command === "list") {
        stream.markdown(`## All Agents (${agents.length})\n\n`);
        const groups: Partial<Record<AgentSource, AgentInfo[]>> = {};
        for (const a of agents) (groups[a.source] ??= []).push(a);
        const icons: Record<AgentSource, string> = {
          user: "👤",
          extension: "🧩",
          workspace: "📁",
        };
        for (const [src, list] of Object.entries(groups) as [
          AgentSource,
          AgentInfo[]
        ][]) {
          stream.markdown(
            `### ${icons[src]} ${src.charAt(0).toUpperCase() + src.slice(1)} (${list.length})\n\n`
          );
          for (const a of list) {
            stream.markdown(`- **\`@${a.name}\`** — ${a.description}\n`);
          }
          stream.markdown("\n");
        }
        return;
      }

      if (!request.prompt.trim()) {
        stream.markdown(
          "Describe your task and I'll route you to the best agent.\n\n" +
            "Use `@route /list` to see all available agents."
        );
        return;
      }

      const results = routeTask(request.prompt);
      let chosenName = results[0]?.agentName ?? "brainstorming";

      if ((results[0]?.score ?? 0) < 5 && agents.length > 0) {
        const agentList = agents
          .map((a) => `- ${a.name}: ${a.description}`)
          .join("\n");
        try {
          const resp = await request.model.sendRequest(
            [
              vscode.LanguageModelChatMessage.User(
                `Given these agents:\n${agentList}\n\n` +
                  `Which single agent best fits this task: "${request.prompt}"\n\n` +
                  `Reply with ONLY the agent name. No punctuation.`
              ),
            ],
            {},
            token
          );
          let out = "";
          for await (const chunk of resp.text) out += chunk;
          const candidate = out.trim().replace(/^@/, "").toLowerCase();
          if (agents.find((a) => a.name === candidate)) chosenName = candidate;
        } catch {
          /* use pattern result */
        }
      }

      const chosen = agents.find((a) => a.name === chosenName);
      const matchedResult = results.find((r) => r.agentName === chosenName);
      const confidence = matchedResult?.confidence ?? "low";

      await opsStore.recordAgentLaunch({
        agentName: chosenName,
        model: chosen?.model ?? "inherit",
        promptText: request.prompt,
        source: "chat-route",
      });
      refreshAll();

      stream.markdown(`## Routing to \`@${chosenName}\`\n\n`);
      stream.markdown(`**Confidence:** ${confidence.toUpperCase()}  \n`);
      if (chosen)
        stream.markdown(`**Why:** ${chosen.description}\n\n---\n\n`);

      if (chosen?.content) {
        const body = chosen.content
          .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
          .trim();
        try {
          const resp = await request.model.sendRequest(
            [
              vscode.LanguageModelChatMessage.User(
                `You are the "${chosenName}" agent.\n\n` +
                  `Agent instructions:\n${body.slice(0, 3000)}\n\n` +
                  `User task: ${request.prompt}\n\nBegin your response.`
              ),
            ],
            {},
            token
          );
          for await (const chunk of resp.text) stream.markdown(chunk);
        } catch {
          stream.markdown(
            `_Could not run inline. Use \`@${chosenName}\` in a fresh chat._`
          );
        }
      }

      const others = results.filter(
        (r) => r.agentName !== chosenName && r.score >= 5
      );
      if (others.length) {
        stream.markdown(
          `\n\n---\n**Alternatives:** ${others
            .map((r) => `\`@${r.agentName}\``)
            .join(", ")}`
        );
      }
    }
  );

  context.subscriptions.push(participant);
}

export function deactivate(): void {}
