"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTreeProvider = exports.AgentLeafItem = exports.AgentGroupItem = void 0;
const vscode = __importStar(require("vscode"));
const agents_1 = require("./agents");
// ─── Tree Item Types ──────────────────────────────────────────────────────────
const SOURCE_LABELS = {
    user: "User Agents",
    extension: "Extension Agents",
    workspace: "Workspace Agents",
};
const SOURCE_ICONS = {
    user: "person",
    extension: "extensions",
    workspace: "folder",
};
class AgentGroupItem extends vscode.TreeItem {
    source;
    agents;
    constructor(source, agents) {
        super(`${SOURCE_LABELS[source]} (${agents.length})`, agents.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None);
        this.source = source;
        this.agents = agents;
        this.iconPath = new vscode.ThemeIcon(SOURCE_ICONS[source]);
        this.contextValue = `agent-group`;
        this.tooltip = `${agents.length} ${SOURCE_LABELS[source].toLowerCase()}`;
    }
}
exports.AgentGroupItem = AgentGroupItem;
class AgentLeafItem extends vscode.TreeItem {
    agent;
    constructor(agent) {
        super(`@${agent.name}`, vscode.TreeItemCollapsibleState.None);
        this.agent = agent;
        this.description = agent.model !== "inherit" ? agent.model : "";
        this.tooltip = new vscode.MarkdownString(`### @${agent.name}\n\n${agent.description}\n\n` +
            `| | |\n|---|---|\n` +
            `| **Source** | ${agent.source} |\n` +
            `| **Model** | ${agent.model} |\n` +
            `| **File** | \`${agent.filePath}\` |`);
        this.iconPath = new vscode.ThemeIcon("robot", new vscode.ThemeColor(agent.source === "user"
            ? "terminal.ansiBlue"
            : agent.source === "workspace"
                ? "terminal.ansiGreen"
                : "disabledForeground"));
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
exports.AgentLeafItem = AgentLeafItem;
// ─── Tree Data Provider ───────────────────────────────────────────────────────
class AgentTreeProvider {
    _onChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onChange.event;
    _agents = [];
    constructor() {
        this._agents = (0, agents_1.discoverAllAgents)();
    }
    refresh() {
        this._agents = (0, agents_1.discoverAllAgents)();
        this._onChange.fire();
    }
    get agentCount() {
        return this._agents.length;
    }
    getAll() {
        return this._agents;
    }
    byName(name) {
        return this._agents.find((a) => a.name === name);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            const grouped = new Map([
                ["user", []],
                ["workspace", []],
                ["extension", []],
            ]);
            for (const a of this._agents)
                grouped.get(a.source).push(a);
            const groups = [];
            for (const [source, agents] of grouped) {
                if (agents.length > 0)
                    groups.push(new AgentGroupItem(source, agents));
            }
            return Promise.resolve(groups);
        }
        if (element instanceof AgentGroupItem) {
            return Promise.resolve(element.agents.map((a) => new AgentLeafItem(a)));
        }
        return Promise.resolve([]);
    }
}
exports.AgentTreeProvider = AgentTreeProvider;
//# sourceMappingURL=treeView.js.map