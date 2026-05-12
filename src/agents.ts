import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentSource = "user" | "extension" | "workspace";

export interface AgentInfo {
  name: string;
  description: string;
  model: string;
  filePath: string;
  content: string;
  source: AgentSource;
  readonly: boolean;
}

export interface RouteResult {
  agentName: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export const USER_PROMPTS_DIR = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Code",
  "User",
  "prompts"
);

const EXTENSION_DIR = path.join(os.homedir(), ".vscode", "extensions");

const EXTRA_USER_DIRS = [
  path.join(os.homedir(), ".copilot", "agents"),
  path.join(os.homedir(), ".superpowers-copilot", "agents"),
];

// ─── Discovery ────────────────────────────────────────────────────────────────

export function parseYamlFrontmatter(content: string): Record<string, string> {
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*"?([^"]*)"?\s*$/);
    if (kv) result[kv[1]] = kv[2].trim();
  }
  return result;
}

function readAgent(filePath: string, source: AgentSource): AgentInfo | null {
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
  } catch {
    return null;
  }
}

function scanDir(dir: string, source: AgentSource): AgentInfo[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".agent.md"))
      .map((f) => readAgent(path.join(dir, f), source))
      .filter((a): a is AgentInfo => a !== null);
  } catch {
    return [];
  }
}

function scanExtensions(): AgentInfo[] {
  if (!fs.existsSync(EXTENSION_DIR)) return [];
  const agents: AgentInfo[] = [];
  try {
    for (const ext of fs.readdirSync(EXTENSION_DIR)) {
      agents.push(
        ...scanDir(path.join(EXTENSION_DIR, ext, ".github", "agents"), "extension")
      );
    }
  } catch { /* skip */ }
  return agents;
}

function scanWorkspace(): AgentInfo[] {
  const agents: AgentInfo[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    agents.push(
      ...scanDir(path.join(folder.uri.fsPath, ".github", "agents"), "workspace"),
      ...scanDir(path.join(folder.uri.fsPath, ".claude", "agents"), "workspace")
    );
  }
  return agents;
}

export function discoverAllAgents(): AgentInfo[] {
  const seen = new Set<string>();
  const result: AgentInfo[] = [];

  const add = (agents: AgentInfo[]) => {
    for (const a of agents) {
      if (!seen.has(a.name)) {
        seen.add(a.name);
        result.push(a);
      }
    }
  };

  add(scanDir(USER_PROMPTS_DIR, "user"));
  for (const d of EXTRA_USER_DIRS) add(scanDir(d, "user"));
  add(scanWorkspace());
  add(scanExtensions());

  return result;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

interface SignalRule {
  pattern: RegExp;
  agent: string;
  score: number;
  reason: string;
}

const SIGNAL_RULES: SignalRule[] = [
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

export function routeTask(prompt: string): RouteResult[] {
  const scores = new Map<string, { score: number; reason: string }>();

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
