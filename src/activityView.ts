import * as vscode from "vscode";
import { DashboardSnapshot, WorkflowStepStatus } from "./state";

interface AgentActivityRow {
  label: string;
  description?: string;
  tooltip: string;
  icon: vscode.ThemeIcon;
  command?: vscode.Command;
}

class AgentActivityGroupItem extends vscode.TreeItem {
  constructor(
    public readonly idKey: string,
    public readonly title: string,
    public readonly rows: AgentActivityRow[]
  ) {
    super(
      `${title} (${rows.length})`,
      rows.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = `agent-activity-group:${idKey}`;
    this.contextValue = "agent-activity-group";
    this.iconPath = new vscode.ThemeIcon("pulse");
  }
}

class AgentActivityLeafItem extends vscode.TreeItem {
  constructor(public readonly row: AgentActivityRow) {
    super(row.label, vscode.TreeItemCollapsibleState.None);
    this.description = row.description;
    this.tooltip = row.tooltip;
    this.command = row.command;
    this.contextValue = "agent-activity-item";
    this.iconPath = row.icon;
  }
}

export class AgentActivityProvider
  implements vscode.TreeDataProvider<AgentActivityGroupItem | AgentActivityLeafItem>
{
  private readonly onDidChangeEmitter = new vscode.EventEmitter<
    AgentActivityGroupItem | AgentActivityLeafItem | undefined | void
  >();

  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  private snapshot?: DashboardSnapshot;

  // Shares the same dashboard snapshot source so sidebar, status bar, and webview stay in sync.
  constructor(private readonly getSnapshot: () => DashboardSnapshot) {}

  refresh(snapshot?: DashboardSnapshot): void {
    this.snapshot = snapshot ?? this.getSnapshot();
    this.onDidChangeEmitter.fire();
  }

  getTreeItem(element: AgentActivityGroupItem | AgentActivityLeafItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: AgentActivityGroupItem | AgentActivityLeafItem
  ): Thenable<(AgentActivityGroupItem | AgentActivityLeafItem)[]> {
    if (element instanceof AgentActivityLeafItem) {
      return Promise.resolve([]);
    }

    const snapshot = this.snapshot ?? this.getSnapshot();

    if (!element) {
      const groups = this.buildGroups(snapshot);
      return Promise.resolve(groups);
    }

    return Promise.resolve(element.rows.map((row) => new AgentActivityLeafItem(row)));
  }

  private buildGroups(snapshot: DashboardSnapshot): AgentActivityGroupItem[] {
    const activeRows: AgentActivityRow[] = [];
    const queuedRows: AgentActivityRow[] = [];

    for (const ticket of snapshot.tickets) {
      const activeStep = ticket.steps.find((step) => step.status === "active");
      if (activeStep) {
        activeRows.push(this.makeStepRow(ticket.id, ticket.title, activeStep.title, activeStep.agentName, "active"));
      }

      if (!activeStep) {
        const queuedStep = ticket.steps.find((step) => step.status === "queued");
        if (queuedStep) {
          queuedRows.push(this.makeStepRow(ticket.id, ticket.title, queuedStep.title, queuedStep.agentName, "queued"));
        }
      }
    }

    const recentRows = snapshot.activity
      .filter((event) => Boolean(event.agentName))
      .slice(0, 20)
      .map((event) => {
        const agentName = event.agentName as string;
        const when = formatTimestamp(event.timestamp);
        return {
          label: `@${agentName}`,
          description: event.message,
          tooltip: `${event.message}\n${when}`,
          icon: new vscode.ThemeIcon("history"),
          command: {
            command: "copilot-agents.openAgentByName",
            title: "Open Agent",
            arguments: [agentName],
          },
        } satisfies AgentActivityRow;
      });

    return [
      new AgentActivityGroupItem("active", "Active Now", activeRows),
      new AgentActivityGroupItem("queued", "Queued Next", queuedRows),
      new AgentActivityGroupItem("recent", "Recent Agent Events", recentRows),
    ];
  }

  private makeStepRow(
    ticketId: string,
    ticketTitle: string,
    stepTitle: string,
    agentName: string,
    status: WorkflowStepStatus
  ): AgentActivityRow {
    const isActive = status === "active";
    const icon = new vscode.ThemeIcon(isActive ? "sync~spin" : "clock");
    const tooltip = [
      `${isActive ? "Active" : "Queued"} step for @${agentName}`,
      `Ticket: ${ticketTitle}`,
      `Step: ${stepTitle}`,
      isActive ? "Action: Complete this step" : "Action: Run this step",
    ].join("\n");

    return {
      label: `@${agentName} - ${stepTitle}`,
      description: ticketTitle,
      tooltip,
      icon,
      command: {
        command: isActive ? "copilot-agents.completeTicketStep" : "copilot-agents.runTicketStep",
        title: isActive ? "Complete Step" : "Run Step",
        arguments: [ticketId],
      },
    };
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
