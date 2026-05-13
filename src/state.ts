import * as vscode from "vscode";
import { AgentInfo, RouteResult } from "./agents";

export type TicketStatus = "new" | "triaged" | "working" | "review" | "blocked" | "done";
export type WorkflowStepStatus = "queued" | "active" | "done" | "blocked";
export type UsageTrackingMode = "estimated" | "manual";

export interface WorkflowStep {
  id: string;
  title: string;
  agentName: string;
  status: WorkflowStepStatus;
  prompt: string;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentTicket {
  id: string;
  title: string;
  prompt: string;
  status: TicketStatus;
  recommendedAgents: string[];
  currentAgentName?: string;
  nextAgentName?: string;
  workspaceLabel: string;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  agentName?: string;
  ticketId?: string;
}

export interface CopilotUsageState {
  planId: string;
  planLabel: string;
  monthlyQuota: number;
  estimatedUsedPremium: number;
  estimatedTokenUnits: number;
  trackingMode: UsageTrackingMode;
  lastUpdatedAt?: string;
  dataSourceNote: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  agentCounts: {
    total: number;
    user: number;
    workspace: number;
    extension: number;
  };
  ticketCounts: {
    total: number;
    new: number;
    triaged: number;
    working: number;
    review: number;
    blocked: number;
    done: number;
    open: number;
  };
  tickets: AgentTicket[];
  queue: Array<{
    ticketId: string;
    ticketTitle: string;
    stepTitle: string;
    agentName: string;
    status: WorkflowStepStatus;
  }>;
  usage: CopilotUsageState & {
    remainingPremium: number;
    percentUsed: number;
  };
  activity: ActivityEvent[];
  workflowAutomation: WorkflowAutomationState;
}

export interface WorkflowAutomationState {
  autoProceedEnabled: boolean;
}

const TICKETS_KEY = "copilot-agents.tickets";
const ACTIVITY_KEY = "copilot-agents.activity";
const USAGE_KEY = "copilot-agents.usage";
const WORKFLOW_AUTOMATION_KEY = "copilot-agents.workflowAutomation";

const DEFAULT_WORKFLOW_AUTOMATION: WorkflowAutomationState = {
  autoProceedEnabled: true,
};

const DEFAULT_USAGE: CopilotUsageState = {
  planId: "pro+",
  planLabel: "Copilot Pro+",
  monthlyQuota: 1500,
  estimatedUsedPremium: 0,
  estimatedTokenUnits: 0,
  trackingMode: "estimated",
  dataSourceNote:
    "Estimated from Agent Manager launches. GitHub does not currently expose live per-user premium balance to VS Code extensions.",
};

const STATUS_ORDER: TicketStatus[] = [
  "new",
  "triaged",
  "working",
  "review",
  "blocked",
  "done",
];

const WORKFLOW_PRESETS: Record<string, Array<{ title: string; agentName: string }>> = {
  "systematic-debugging": [
    { title: "Diagnose", agentName: "systematic-debugging" },
    { title: "Coordinate Fix", agentName: "subagent-driven-development" },
    { title: "Verify", agentName: "verification-before-completion" },
  ],
  brainstorming: [
    { title: "Explore", agentName: "brainstorming" },
    { title: "Plan", agentName: "writing-plans" },
    { title: "Build", agentName: "subagent-driven-development" },
    { title: "Verify", agentName: "verification-before-completion" },
  ],
  "writing-plans": [
    { title: "Plan", agentName: "writing-plans" },
    { title: "Build", agentName: "executing-plans" },
    { title: "Verify", agentName: "verification-before-completion" },
  ],
  "subagent-driven-development": [
    { title: "Plan", agentName: "writing-plans" },
    { title: "Coordinate", agentName: "subagent-driven-development" },
    { title: "Review", agentName: "requesting-code-review" },
    { title: "Verify", agentName: "verification-before-completion" },
  ],
  "test-driven-development": [
    { title: "Test First", agentName: "test-driven-development" },
    { title: "Review", agentName: "requesting-code-review" },
    { title: "Verify", agentName: "verification-before-completion" },
  ],
  "receiving-code-review": [
    { title: "Respond", agentName: "receiving-code-review" },
    { title: "Verify", agentName: "verification-before-completion" },
  ],
  "requesting-code-review": [
    { title: "Review", agentName: "requesting-code-review" },
    { title: "Verify", agentName: "verification-before-completion" },
  ],
  "verification-before-completion": [
    { title: "Verify", agentName: "verification-before-completion" },
    { title: "Finish", agentName: "finishing-a-development-branch" },
  ],
  "finishing-a-development-branch": [
    { title: "Verify", agentName: "verification-before-completion" },
    { title: "Finish", agentName: "finishing-a-development-branch" },
  ],
};

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupeAgents(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function humanizeAgentName(agentName: string): string {
  return agentName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function deriveTitleFromPrompt(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, " ").trim();
  if (!singleLine) return "Untitled Ticket";
  const firstSentence = singleLine.split(/[.!?]/)[0]?.trim() || singleLine;
  return firstSentence.length <= 72
    ? firstSentence
    : `${firstSentence.slice(0, 69).trimEnd()}...`;
}

function estimatePromptTokens(promptText: string): number {
  const trimmed = promptText.trim();
  if (!trimmed) return 0;
  return Math.max(24, Math.ceil(trimmed.length / 4));
}

function estimateModelMultiplier(model: string): number {
  const match = model.match(/(\d+(?:\.\d+)?)x/i);
  return match ? Number(match[1]) : 1;
}

function deriveTicketStatus(steps: WorkflowStep[]): TicketStatus {
  if (steps.some((step) => step.status === "blocked")) return "blocked";
  if (steps.length > 0 && steps.every((step) => step.status === "done")) return "done";

  const active = steps.find((step) => step.status === "active");
  if (active) {
    return /review/.test(active.agentName) || /review/i.test(active.title)
      ? "review"
      : "working";
  }

  const completedCount = steps.filter((step) => step.status === "done").length;
  if (completedCount === 0) return "new";
  if (completedCount === 1) return "triaged";
  return "working";
}

function deriveCurrentAgentName(steps: WorkflowStep[]): string | undefined {
  return steps.find((step) => step.status === "active")?.agentName;
}

function deriveNextAgentName(steps: WorkflowStep[]): string | undefined {
  return (
    steps.find((step) => step.status === "active")?.agentName ||
    steps.find((step) => step.status === "queued")?.agentName
  );
}

function normalizeTicket(ticket: AgentTicket): AgentTicket {
  const steps = ticket.steps ?? [];
  return {
    ...ticket,
    workspaceLabel: ticket.workspaceLabel || "Workspace",
    recommendedAgents: dedupeAgents(ticket.recommendedAgents ?? []),
    steps,
    status: deriveTicketStatus(steps),
    currentAgentName: deriveCurrentAgentName(steps),
    nextAgentName: deriveNextAgentName(steps),
  };
}

function normalizeUsage(usage: Partial<CopilotUsageState> | undefined): CopilotUsageState {
  return {
    ...DEFAULT_USAGE,
    ...usage,
  };
}

function normalizeWorkflowAutomation(
  workflowAutomation: Partial<WorkflowAutomationState> | undefined
): WorkflowAutomationState {
  return {
    ...DEFAULT_WORKFLOW_AUTOMATION,
    ...workflowAutomation,
  };
}

function buildWorkflow(prompt: string, routeResults: RouteResult[]): WorkflowStep[] {
  const recommendedAgents = dedupeAgents(routeResults.map((result) => result.agentName));
  const leadAgent = recommendedAgents[0] ?? "brainstorming";
  const preset = WORKFLOW_PRESETS[leadAgent] ?? [
    { title: humanizeAgentName(leadAgent), agentName: leadAgent },
  ];

  const appended = recommendedAgents
    .filter((agentName) => !preset.some((step) => step.agentName === agentName))
    .slice(0, 2)
    .map((agentName, index) => ({
      title: index === 0 ? "Support" : "Follow-up",
      agentName,
    }));

  const workflow = [...preset, ...appended];
  if (!workflow.some((step) => step.agentName === "verification-before-completion")) {
    workflow.push({ title: "Verify", agentName: "verification-before-completion" });
  }

  const deduped = dedupeAgents(workflow.map((step) => step.agentName)).map((agentName) => {
    const match = workflow.find((step) => step.agentName === agentName);
    return match ?? { title: humanizeAgentName(agentName), agentName };
  });

  return deduped.slice(0, 5).map((step) => ({
    id: makeId("step"),
    title: step.title,
    agentName: step.agentName,
    status: "queued",
    prompt,
  }));
}

export class AgentOpsStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getTickets(): AgentTicket[] {
    return this.context.workspaceState
      .get<AgentTicket[]>(TICKETS_KEY, [])
      .map((ticket) => normalizeTicket(ticket))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  findTicket(ticketId: string): AgentTicket | undefined {
    return this.getTickets().find((ticket) => ticket.id === ticketId);
  }

  getActivity(): ActivityEvent[] {
    return this.context.workspaceState.get<ActivityEvent[]>(ACTIVITY_KEY, []);
  }

  getUsage(): CopilotUsageState {
    return normalizeUsage(this.context.globalState.get<Partial<CopilotUsageState>>(USAGE_KEY));
  }

  getWorkflowAutomation(): WorkflowAutomationState {
    return normalizeWorkflowAutomation(
      this.context.workspaceState.get<Partial<WorkflowAutomationState>>(WORKFLOW_AUTOMATION_KEY)
    );
  }

  async setWorkflowAutomation(
    input: Partial<WorkflowAutomationState>
  ): Promise<WorkflowAutomationState> {
    const current = this.getWorkflowAutomation();
    const next = normalizeWorkflowAutomation({
      ...current,
      ...input,
    });
    await this.context.workspaceState.update(WORKFLOW_AUTOMATION_KEY, next);
    await this.recordEvent({
      type: "workflow-automation-updated",
      message: `Workflow auto proceed ${next.autoProceedEnabled ? "enabled" : "disabled"}`,
    });
    return next;
  }

  async createTicket(input: {
    prompt: string;
    routeResults: RouteResult[];
    workspaceLabel?: string;
    title?: string;
  }): Promise<AgentTicket> {
    const now = new Date().toISOString();
    const recommendedAgents = dedupeAgents(input.routeResults.map((result) => result.agentName));
    const ticket = normalizeTicket({
      id: makeId("ticket"),
      title: input.title?.trim() || deriveTitleFromPrompt(input.prompt),
      prompt: input.prompt,
      status: "new",
      recommendedAgents,
      workspaceLabel: input.workspaceLabel || "Workspace",
      createdAt: now,
      updatedAt: now,
      steps: buildWorkflow(input.prompt, input.routeResults),
    });

    const tickets = [ticket, ...this.getTickets()].slice(0, 120);
    await this.context.workspaceState.update(TICKETS_KEY, tickets);
    await this.recordEvent({
      type: "ticket-created",
      message: `Created ticket: ${ticket.title}`,
      ticketId: ticket.id,
      agentName: ticket.nextAgentName,
    });
    return ticket;
  }

  async beginNextStep(ticketId: string): Promise<{ ticket: AgentTicket; step: WorkflowStep } | undefined> {
    const tickets = this.getTickets();
    const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
    if (ticketIndex < 0) return undefined;

    const ticket = { ...tickets[ticketIndex], steps: tickets[ticketIndex].steps.map((step) => ({ ...step })) };
    const activeIndex = ticket.steps.findIndex((step) => step.status === "active");
    const queuedIndex = ticket.steps.findIndex((step) => step.status === "queued");
    const stepIndex = activeIndex >= 0 ? activeIndex : queuedIndex;
    if (stepIndex < 0) return undefined;

    const now = new Date().toISOString();
    ticket.steps[stepIndex] = {
      ...ticket.steps[stepIndex],
      status: "active",
      startedAt: ticket.steps[stepIndex].startedAt || now,
    };
    ticket.updatedAt = now;

    const normalized = normalizeTicket(ticket);
    tickets[ticketIndex] = normalized;
    await this.context.workspaceState.update(TICKETS_KEY, tickets);
    await this.recordEvent({
      type: "ticket-step-started",
      message: `${normalized.title} -> ${normalized.steps[stepIndex].title}`,
      ticketId: normalized.id,
      agentName: normalized.steps[stepIndex].agentName,
    });
    return {
      ticket: normalized,
      step: normalized.steps[stepIndex],
    };
  }

  async completeActiveStep(ticketId: string, summary: string): Promise<AgentTicket | undefined> {
    const tickets = this.getTickets();
    const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
    if (ticketIndex < 0) return undefined;

    const ticket = { ...tickets[ticketIndex], steps: tickets[ticketIndex].steps.map((step) => ({ ...step })) };
    const stepIndex = ticket.steps.findIndex((step) => step.status === "active");
    if (stepIndex < 0) return undefined;

    const now = new Date().toISOString();
    ticket.steps[stepIndex] = {
      ...ticket.steps[stepIndex],
      status: "done",
      completedAt: now,
      summary: summary.trim(),
    };
    ticket.updatedAt = now;

    const normalized = normalizeTicket(ticket);
    tickets[ticketIndex] = normalized;
    await this.context.workspaceState.update(TICKETS_KEY, tickets);
    await this.recordEvent({
      type: "ticket-step-completed",
      message: `${normalized.title} completed ${normalized.steps[stepIndex].title}`,
      ticketId: normalized.id,
      agentName: normalized.steps[stepIndex].agentName,
    });
    return normalized;
  }

  async configureUsage(input: {
    planId: string;
    planLabel: string;
    monthlyQuota: number;
    trackingMode?: UsageTrackingMode;
    baselinePremiumUsed?: number;
    baselineTokens?: number;
  }): Promise<CopilotUsageState> {
    const current = this.getUsage();
    const next: CopilotUsageState = {
      ...current,
      planId: input.planId,
      planLabel: input.planLabel,
      monthlyQuota: input.monthlyQuota,
      trackingMode: input.trackingMode ?? current.trackingMode,
      estimatedUsedPremium:
        input.baselinePremiumUsed ?? current.estimatedUsedPremium,
      estimatedTokenUnits: input.baselineTokens ?? current.estimatedTokenUnits,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.context.globalState.update(USAGE_KEY, next);
    await this.recordEvent({
      type: "usage-configured",
      message: `Configured ${next.planLabel} at ${next.monthlyQuota} premium requests`,
    });
    return next;
  }

  async recordAgentLaunch(input: {
    agentName: string;
    model: string;
    promptText: string;
    source: string;
    ticketId?: string;
  }): Promise<CopilotUsageState> {
    const current = this.getUsage();
    const deltaPremium = estimateModelMultiplier(input.model);
    const deltaTokens = estimatePromptTokens(input.promptText);
    const next: CopilotUsageState = {
      ...current,
      estimatedUsedPremium: current.estimatedUsedPremium + deltaPremium,
      estimatedTokenUnits: current.estimatedTokenUnits + deltaTokens,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.context.globalState.update(USAGE_KEY, next);
    await this.recordEvent({
      type: "usage-recorded",
      message: `${input.agentName} launch recorded from ${input.source}`,
      ticketId: input.ticketId,
      agentName: input.agentName,
    });
    return next;
  }

  async recordEvent(event: {
    type: string;
    message: string;
    ticketId?: string;
    agentName?: string;
  }): Promise<void> {
    const activity = this.getActivity();
    const next: ActivityEvent[] = [
      {
        id: makeId("evt"),
        timestamp: new Date().toISOString(),
        type: event.type,
        message: event.message,
        ticketId: event.ticketId,
        agentName: event.agentName,
      },
      ...activity,
    ].slice(0, 80);
    await this.context.workspaceState.update(ACTIVITY_KEY, next);
  }

  getSnapshot(agents: AgentInfo[]): DashboardSnapshot {
    const tickets = this.getTickets();
    const usage = this.getUsage();
    const agentCounts = {
      total: agents.length,
      user: agents.filter((agent) => agent.source === "user").length,
      workspace: agents.filter((agent) => agent.source === "workspace").length,
      extension: agents.filter((agent) => agent.source === "extension").length,
    };

    const ticketCounts = {
      total: tickets.length,
      new: tickets.filter((ticket) => ticket.status === "new").length,
      triaged: tickets.filter((ticket) => ticket.status === "triaged").length,
      working: tickets.filter((ticket) => ticket.status === "working").length,
      review: tickets.filter((ticket) => ticket.status === "review").length,
      blocked: tickets.filter((ticket) => ticket.status === "blocked").length,
      done: tickets.filter((ticket) => ticket.status === "done").length,
      open: tickets.filter((ticket) => ticket.status !== "done").length,
    };

    const queue = tickets
      .map((ticket) => {
        const step =
          ticket.steps.find((candidate) => candidate.status === "active") ||
          ticket.steps.find((candidate) => candidate.status === "queued");
        if (!step) return undefined;
        return {
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          stepTitle: step.title,
          agentName: step.agentName,
          status: step.status,
        };
      })
      .filter((item): item is DashboardSnapshot["queue"][number] => item !== undefined);

    const remainingPremium = Math.max(0, usage.monthlyQuota - usage.estimatedUsedPremium);
    const percentUsed = usage.monthlyQuota > 0
      ? Math.min(100, Math.round((usage.estimatedUsedPremium / usage.monthlyQuota) * 100))
      : 0;

    return {
      generatedAt: new Date().toISOString(),
      agentCounts,
      ticketCounts,
      tickets: tickets.sort((left, right) => {
        const leftOrder = STATUS_ORDER.indexOf(left.status);
        const rightOrder = STATUS_ORDER.indexOf(right.status);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return right.updatedAt.localeCompare(left.updatedAt);
      }),
      queue,
      usage: {
        ...usage,
        remainingPremium,
        percentUsed,
      },
      activity: this.getActivity(),
      workflowAutomation: this.getWorkflowAutomation(),
    };
  }
}

export { deriveTitleFromPrompt, humanizeAgentName };