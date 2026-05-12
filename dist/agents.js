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
exports.USER_PROMPTS_DIR = void 0;
exports.parseYamlFrontmatter = parseYamlFrontmatter;
exports.discoverAllAgents = discoverAllAgents;
exports.routeTask = routeTask;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const vscode = __importStar(require("vscode"));
// ─── Paths ────────────────────────────────────────────────────────────────────
exports.USER_PROMPTS_DIR = path.join(os.homedir(), "AppData", "Roaming", "Code", "User", "prompts");
const EXTENSION_DIR = path.join(os.homedir(), ".vscode", "extensions");
const EXTRA_USER_DIRS = [
    path.join(os.homedir(), ".copilot", "agents"),
    path.join(os.homedir(), ".superpowers-copilot", "agents"),
];
// ─── Discovery ────────────────────────────────────────────────────────────────
function parseYamlFrontmatter(content) {
    const normalized = content.replace(/^\uFEFF/, "");
    const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return {};
    const result = {};
    for (const line of match[1].split(/\r?\n/)) {
        const kv = line.match(/^([\w-]+):\s*"?([^"]*)"?\s*$/);
        if (kv)
            result[kv[1]] = kv[2].trim();
    }
    return result;
}
function readAgent(filePath, source) {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const meta = parseYamlFrontmatter(content);
        return {
            name: path.basename(filePath, ".agent.md"),
            description: meta.description || "(no description)",
            model: meta.model || "inherit",
            filePath,
            content,
            source,
            readonly: source === "extension",
        };
    }
    catch {
        return null;
    }
}
function scanDir(dir, source) {
    if (!fs.existsSync(dir))
        return [];
    try {
        return fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".agent.md"))
            .map((f) => readAgent(path.join(dir, f), source))
            .filter((a) => a !== null);
    }
    catch {
        return [];
    }
}
function scanExtensions() {
    if (!fs.existsSync(EXTENSION_DIR))
        return [];
    const agents = [];
    try {
        for (const ext of fs.readdirSync(EXTENSION_DIR)) {
            agents.push(...scanDir(path.join(EXTENSION_DIR, ext, ".github", "agents"), "extension"));
        }
    }
    catch { /* skip */ }
    return agents;
}
function scanWorkspace() {
    const agents = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        agents.push(...scanDir(path.join(folder.uri.fsPath, ".github", "agents"), "workspace"), ...scanDir(path.join(folder.uri.fsPath, ".claude", "agents"), "workspace"));
    }
    return agents;
}
function discoverAllAgents() {
    const seen = new Set();
    const result = [];
    const add = (agents) => {
        for (const a of agents) {
            if (!seen.has(a.name)) {
                seen.add(a.name);
                result.push(a);
            }
        }
    };
    add(scanDir(exports.USER_PROMPTS_DIR, "user"));
    for (const d of EXTRA_USER_DIRS)
        add(scanDir(d, "user"));
    add(scanWorkspace());
    add(scanExtensions());
    return result;
}
const SIGNAL_RULES = [
    { pattern: /vscode|visual.?studio.?code|mcp|register.*(tool|server|integration)|integration/i, agent: "subagent-driven-development", score: 8, reason: "platform integration signal" },
    { pattern: /error|exception|stack.?trace|failing|failed|broken|bug|crash|not.?work/i, agent: "systematic-debugging", score: 10, reason: "debug signal" },
    { pattern: /review.?feedback|pr.?comment|lgtm|reviewer.?said|inline.?review/i, agent: "receiving-code-review", score: 10, reason: "review feedback" },
    { pattern: /all.?tests?.?pass|ready.?to.?(ship|merge|deploy)|done.?implement/i, agent: "finishing-a-development-branch", score: 9, reason: "branch completion" },
    { pattern: /verify|check.?before.?(commit|merge|push)|before.?i.?(commit|merge)/i, agent: "verification-before-completion", score: 9, reason: "verification request" },
    { pattern: /write.?a.?plan|create.?spec|design.?doc|architect|make.?a.?plan/i, agent: "writing-plans", score: 8, reason: "planning/spec" },
    { pattern: /execute.?(this.?)?plan|implement.?(the.?)?plan/i, agent: "executing-plans", score: 8, reason: "plan execution" },
    { pattern: /tdd|test.?driven|write.?tests?.?first|red.?green/i, agent: "test-driven-development", score: 8, reason: "TDD signal" },
    { pattern: /submit.?for.?review|request.?review|review.?my.?code/i, agent: "requesting-code-review", score: 7, reason: "review request" },
    { pattern: /worktree|isolated.?branch|don.?t.?touch.?main/i, agent: "using-git-worktrees", score: 7, reason: "worktree signal" },
    { pattern: /\.agent\.md|write.?an?.?agent|create.?agent|edit.?agent/i, agent: "writing-agents", score: 7, reason: "agent authoring" },
    { pattern: /multiple.?(broken|fail)|fix.?all|parallel.?tasks?/i, agent: "dispatching-parallel-agents", score: 6, reason: "parallel tasks" },
    { pattern: /multi.?step|end.?to.?end|subagent/i, agent: "subagent-driven-development", score: 6, reason: "multi-step task" },
    { pattern: /i.?want.?to.?build|add.?feature|implement|new.?functionality/i, agent: "brainstorming", score: 3, reason: "feature request" },
];
function routeTask(prompt) {
    const scores = new Map();
    for (const rule of SIGNAL_RULES) {
        if (rule.pattern.test(prompt)) {
            const existing = scores.get(rule.agent);
            if (!existing || rule.score > existing.score) {
                scores.set(rule.agent, { score: rule.score, reason: rule.reason });
            }
        }
    }
    if (scores.size === 0) {
        scores.set("brainstorming", { score: 1, reason: "no signal — default" });
    }
    return Array.from(scores.entries())
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 3)
        .map(([agentName, { score, reason }]) => ({
        agentName,
        score,
        confidence: score >= 9 ? "high" : score >= 6 ? "medium" : "low",
        reason,
    }));
}
//# sourceMappingURL=agents.js.map