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
exports.AgentActivityProvider = void 0;
const vscode = __importStar(require("vscode"));
class AgentActivityGroupItem extends vscode.TreeItem {
    idKey;
    title;
    rows;
    constructor(idKey, title, rows) {
        super(`${title} (${rows.length})`, rows.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None);
        this.idKey = idKey;
        this.title = title;
        this.rows = rows;
        this.id = `agent-activity-group:${idKey}`;
        this.contextValue = "agent-activity-group";
        this.iconPath = new vscode.ThemeIcon("pulse");
    }
}
class AgentActivityLeafItem extends vscode.TreeItem {
    row;
    constructor(row) {
        super(row.label, vscode.TreeItemCollapsibleState.None);
        this.row = row;
        this.description = row.description;
        this.tooltip = row.tooltip;
        this.command = row.command;
        this.contextValue = "agent-activity-item";
        this.iconPath = row.icon;
    }
}
class AgentActivityProvider {
    getSnapshot;
    onDidChangeEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeEmitter.event;
    snapshot;
    // Shares the same dashboard snapshot source so sidebar, status bar, and webview stay in sync.
    constructor(getSnapshot) {
        this.getSnapshot = getSnapshot;
    }
    refresh(snapshot) {
        this.snapshot = snapshot ?? this.getSnapshot();
        this.onDidChangeEmitter.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
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
    buildGroups(snapshot) {
        const activeRows = [];
        const queuedRows = [];
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
            const agentName = event.agentName;
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
            };
        });
        return [
            new AgentActivityGroupItem("active", "Active Now", activeRows),
            new AgentActivityGroupItem("queued", "Queued Next", queuedRows),
            new AgentActivityGroupItem("recent", "Recent Agent Events", recentRows),
        ];
    }
    makeStepRow(ticketId, ticketTitle, stepTitle, agentName, status) {
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
exports.AgentActivityProvider = AgentActivityProvider;
function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
//# sourceMappingURL=activityView.js.map