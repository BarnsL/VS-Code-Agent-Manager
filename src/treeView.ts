import * as vscode from "vscode";
import { AgentInfo, AgentSource, discoverAllAgents } from "./agents";

// ─── Tree Item Types ──────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<AgentSource, string> = {
  user: "User Agents",
  extension: "Extension Agents",
  workspace: "Workspace Agents",
};

const SOURCE_ICONS: Record<AgentSource, string> = {
  user: "person",
  extension: "extensions",
  workspace: "folder",
};

export class AgentGroupItem extends vscode.TreeItem {
  constructor(
    public readonly source: AgentSource,
    public readonly agents: AgentInfo[]
  ) {
    super(
      `${SOURCE_LABELS[source]} (${agents.length})`,
      agents.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    this.iconPath = new vscode.ThemeIcon(SOURCE_ICONS[source]);
    this.contextValue = `agent-group`;
    this.tooltip = `${agents.length} ${SOURCE_LABELS[source].toLowerCase()}`;
  }
}

export class AgentLeafItem extends vscode.TreeItem {
  constructor(public readonly agent: AgentInfo) {
    super(`@${agent.name}`, vscode.TreeItemCollapsibleState.None);
    this.description = agent.model !== "inherit" ? agent.model : "";
    this.tooltip = new vscode.MarkdownString(
      `### @${agent.name}\n\n${agent.description}\n\n` +
      `| | |\n|---|---|\n` +
      `| **Source** | ${agent.source} |\n` +
      `| **Model** | ${agent.model} |\n` +
      `| **File** | \`${agent.filePath}\` |`
    );
    this.iconPath = new vscode.ThemeIcon(
      "robot",
      new vscode.ThemeColor(
        agent.source === "user"
          ? "terminal.ansiBlue"
          : agent.source === "workspace"
          ? "terminal.ansiGreen"
          : "disabledForeground"
      )
    );
    // contextValue drives which menu items appear
    this.contextValue =
      agent.source === "extension" ? "agent-extension" : `agent-editable`;
    // Single-click opens the file
    this.command = {
      command: "copilot-agents.openAgent",
      title: "Open Agent",
      arguments: [agent],
    };
  }
}

// ─── Tree Data Provider ───────────────────────────────────────────────────────

export class AgentTreeProvider
  implements vscode.TreeDataProvider<AgentGroupItem | AgentLeafItem>
{
  private _onChange = new vscode.EventEmitter<
    AgentGroupItem | AgentLeafItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onChange.event;

  private _agents: AgentInfo[] = [];

  constructor() {
    this._agents = discoverAllAgents();
  }

  refresh(): void {
    this._agents = discoverAllAgents();
    this._onChange.fire();
  }

  get agentCount(): number {
    return this._agents.length;
  }

  getAll(): AgentInfo[] {
    return this._agents;
  }

  byName(name: string): AgentInfo | undefined {
    return this._agents.find((a) => a.name === name);
  }

  getTreeItem(element: AgentGroupItem | AgentLeafItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: AgentGroupItem | AgentLeafItem
  ): Thenable<(AgentGroupItem | AgentLeafItem)[]> {
    if (!element) {
      const grouped = new Map<AgentSource, AgentInfo[]>([
        ["user", []],
        ["workspace", []],
        ["extension", []],
      ]);
      for (const a of this._agents) grouped.get(a.source)!.push(a);

      const groups: AgentGroupItem[] = [];
      for (const [source, agents] of grouped) {
        if (agents.length > 0) groups.push(new AgentGroupItem(source, agents));
      }
      return Promise.resolve(groups);
    }

    if (element instanceof AgentGroupItem) {
      return Promise.resolve(element.agents.map((a) => new AgentLeafItem(a)));
    }

    return Promise.resolve([]);
  }
}
