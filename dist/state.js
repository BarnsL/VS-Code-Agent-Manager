"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOpsStore = void 0;
exports.deriveTitleFromPrompt = deriveTitleFromPrompt;
exports.humanizeAgentName = humanizeAgentName;
const TICKETS_KEY = "copilot-agents.tickets";
const ACTIVITY_KEY = "copilot-agents.activity";
const USAGE_KEY = "copilot-agents.usage";
const WORKFLOW_AUTOMATION_KEY = "copilot-agents.workflowAutomation";
const DEFAULT_WORKFLOW_AUTOMATION = {
    autoProceedEnabled: true,
};
const DEFAULT_USAGE = {
    planId: "pro+",
    planLabel: "Copilot Pro+",
    monthlyQuota: 1500,
    estimatedUsedPremium: 0,
    estimatedTokenUnits: 0,
    trackingMode: "estimated",
    dataSourceNote: "",
};
const STATUS_ORDER = [
    "new",
    "triaged",
    "working",
    "review",
    "blocked",
    "done",
];
const WORKFLOW_PRESETS = {
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
function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function dedupeAgents(names) {
    const seen = new Set();
    const result = [];
    for (const name of names) {
        if (!name || seen.has(name))
            continue;
        seen.add(name);
        result.push(name);
    }
    return result;
}
function humanizeAgentName(agentName) {
    return agentName
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
function deriveTitleFromPrompt(prompt) {
    const singleLine = prompt.replace(/\s+/g, " ").trim();
    if (!singleLine)
        return "Untitled Ticket";
    const firstSentence = singleLine.split(/[.!?]/)[0]?.trim() || singleLine;
    return firstSentence.length <= 72
        ? firstSentence
        : `${firstSentence.slice(0, 69).trimEnd()}...`;
}
function estimatePromptTokens(promptText) {
    const trimmed = promptText.trim();
    if (!trimmed)
        return 0;
    return Math.max(24, Math.ceil(trimmed.length / 4));
}
function estimateModelMultiplier(model) {
    const match = model.match(/(\d+(?:\.\d+)?)x/i);
    return match ? Number(match[1]) : 1;
}
function deriveTicketStatus(ticket) {
    const steps = ticket.steps ?? [];
    if (steps.some((step) => step.status === "blocked"))
        return "blocked";
    const allStepsDone = steps.length > 0 && steps.every((step) => step.status === "done");
    if (allStepsDone) {
        if (ticket.closureAcceptedAt)
            return "done";
        if (ticket.closureRequestedAt)
            return "review";
    }
    // "awaiting-output" counts as still working — the manager is holding for
    // the prior step's chat output before composing the next prompt.
    const inFlight = steps.find((step) => step.status === "active" || step.status === "awaiting-output");
    if (inFlight) {
        return /review/.test(inFlight.agentName) || /review/i.test(inFlight.title)
            ? "review"
            : "working";
    }
    const completedCount = steps.filter((step) => step.status === "done").length;
    if (completedCount === 0)
        return "new";
    if (completedCount === 1)
        return "triaged";
    return "working";
}
function deriveCurrentAgentName(steps) {
    return steps.find((step) => step.status === "active" || step.status === "awaiting-output")?.agentName;
}
function deriveNextAgentName(ticket) {
    if (ticket.closureRequestedAt && !ticket.closureAcceptedAt) {
        return "Awaiting your acceptance";
    }
    const steps = ticket.steps ?? [];
    return (steps.find((step) => step.status === "active" || step.status === "awaiting-output")?.agentName ||
        steps.find((step) => step.status === "queued")?.agentName);
}
function normalizeTicket(ticket) {
    const steps = ticket.steps ?? [];
    const legacyClosureAcceptedAt = ticket.closureAcceptedAt ||
        (ticket.status === "done" && steps.length > 0 && steps.every((step) => step.status === "done")
            ? ticket.updatedAt
            : undefined);
    const normalized = {
        ...ticket,
        workspaceLabel: ticket.workspaceLabel || "Workspace",
        recommendedAgents: dedupeAgents(ticket.recommendedAgents ?? []),
        steps,
        steeringNote: ticket.steeringNote?.trim(),
        closureRequestedAt: ticket.closureRequestedAt || legacyClosureAcceptedAt,
        closureAcceptedAt: legacyClosureAcceptedAt,
        closureSummary: ticket.closureSummary?.trim(),
    };
    return {
        ...normalized,
        status: deriveTicketStatus(normalized),
        currentAgentName: deriveCurrentAgentName(steps),
        nextAgentName: deriveNextAgentName(normalized),
    };
}
function normalizeUsage(usage) {
    const merged = {
        ...DEFAULT_USAGE,
        ...usage,
    };
    // v1.2.0: drop the legacy data-source disclaimer if it was previously
    // persisted to globalState by an older install.
    if (merged.dataSourceNote ===
        "Estimated from Agent Manager launches. GitHub does not currently expose live per-user premium balance to VS Code extensions.") {
        merged.dataSourceNote = "";
    }
    return merged;
}
function normalizeWorkflowAutomation(workflowAutomation) {
    return {
        ...DEFAULT_WORKFLOW_AUTOMATION,
        ...workflowAutomation,
    };
}
// v1.2.0 — single-seed-step planning. The manager no longer pre-queues an
// entire pipeline up front. Only the LEAD step is enqueued at ticket
// creation; subsequent steps are appended dynamically by `planNextStep`
// (see managerLlm.ts) AFTER the prior step's chat output is captured. This
// fixes the "queues everything at once and marks done immediately" bug.
function buildWorkflow(prompt, routeResults) {
    const recommendedAgents = dedupeAgents(routeResults.map((result) => result.agentName));
    const leadAgent = recommendedAgents[0] ?? "brainstorming";
    const preset = WORKFLOW_PRESETS[leadAgent];
    const lead = preset?.[0] ?? { title: humanizeAgentName(leadAgent), agentName: leadAgent };
    return [
        {
            id: makeId("step"),
            title: lead.title,
            agentName: lead.agentName,
            status: "queued",
            prompt,
        },
    ];
}
class AgentOpsStore {
    context;
    constructor(context) {
        this.context = context;
    }
    getTickets() {
        return this.context.workspaceState
            .get(TICKETS_KEY, [])
            .map((ticket) => normalizeTicket(ticket))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
    findTicket(ticketId) {
        return this.getTickets().find((ticket) => ticket.id === ticketId);
    }
    getActivity() {
        return this.context.workspaceState.get(ACTIVITY_KEY, []);
    }
    getUsage() {
        return normalizeUsage(this.context.globalState.get(USAGE_KEY));
    }
    getWorkflowAutomation() {
        return normalizeWorkflowAutomation(this.context.workspaceState.get(WORKFLOW_AUTOMATION_KEY));
    }
    async setWorkflowAutomation(input) {
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
    async createTicket(input) {
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
            continuousMode: true,
            autonomousMode: true,
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
    async beginNextStep(ticketId) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = { ...tickets[ticketIndex], steps: tickets[ticketIndex].steps.map((step) => ({ ...step })) };
        const activeIndex = ticket.steps.findIndex((step) => step.status === "active");
        const queuedIndex = ticket.steps.findIndex((step) => step.status === "queued");
        const stepIndex = activeIndex >= 0 ? activeIndex : queuedIndex;
        if (stepIndex < 0)
            return undefined;
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
    async completeActiveStep(ticketId, summary, options = {}) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = { ...tickets[ticketIndex], steps: tickets[ticketIndex].steps.map((step) => ({ ...step })) };
        // Accept active OR awaiting-output as the step we are completing — the
        // awaiting-output state is transient and only used by the UI to show that
        // the manager is holding for chat output before advancing.
        const stepIndex = ticket.steps.findIndex((step) => step.status === "active" || step.status === "awaiting-output");
        if (stepIndex < 0)
            return undefined;
        const now = new Date().toISOString();
        ticket.steps[stepIndex] = {
            ...ticket.steps[stepIndex],
            status: "done",
            completedAt: now,
            summary: summary.trim(),
            output: options.output?.trim() || ticket.steps[stepIndex].output,
            analysis: options.analysis?.trim() || ticket.steps[stepIndex].analysis,
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
    /**
     * Park the active step in `awaiting-output` and persist the captured chat
     * output + manager analysis. Used by the new structured advance flow so the
     * next agent always receives the literal text the prior agent produced.
     */
    async markStepAwaitingOutput(ticketId, payload) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = { ...tickets[ticketIndex], steps: tickets[ticketIndex].steps.map((step) => ({ ...step })) };
        const stepIndex = ticket.steps.findIndex((step) => step.status === "active" || step.status === "awaiting-output");
        if (stepIndex < 0)
            return undefined;
        const now = new Date().toISOString();
        ticket.steps[stepIndex] = {
            ...ticket.steps[stepIndex],
            status: "awaiting-output",
            output: payload.output.trim(),
            analysis: payload.analysis?.trim() || ticket.steps[stepIndex].analysis,
        };
        ticket.updatedAt = now;
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-step-output-captured",
            message: `${normalized.title} captured output for ${normalized.steps[stepIndex].title}`,
            ticketId: normalized.id,
            agentName: normalized.steps[stepIndex].agentName,
        });
        return normalized;
    }
    /**
     * Replace the agent assigned to a still-queued step. Lets users hand-pick a
     * different agent before the manager launches it.
     */
    async reassignStepAgent(ticketId, stepId, nextAgentName) {
        const trimmed = nextAgentName.trim();
        if (!trimmed)
            return undefined;
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = { ...tickets[ticketIndex], steps: tickets[ticketIndex].steps.map((step) => ({ ...step })) };
        const stepIndex = ticket.steps.findIndex((step) => step.id === stepId);
        if (stepIndex < 0)
            return undefined;
        if (ticket.steps[stepIndex].status !== "queued")
            return undefined;
        const previousAgent = ticket.steps[stepIndex].agentName;
        ticket.steps[stepIndex] = {
            ...ticket.steps[stepIndex],
            agentName: trimmed,
        };
        ticket.updatedAt = new Date().toISOString();
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-step-reassigned",
            message: `${normalized.title} reassigned ${normalized.steps[stepIndex].title}: @${previousAgent} -> @${trimmed}`,
            ticketId: normalized.id,
            agentName: trimmed,
        });
        return normalized;
    }
    /**
     * v1.2.0 — append a dynamically-planned next step. Called by the LLM-driven
     * manager after the prior step's chat output is captured + analyzed. The
     * tailored `prompt` becomes the per-step custom instruction set the next
     * agent receives (in addition to the structured handoff context).
     */
    async appendDynamicStep(ticketId, input) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = { ...tickets[ticketIndex], steps: tickets[ticketIndex].steps.map((step) => ({ ...step })) };
        ticket.steps.push({
            id: makeId("step"),
            title: input.title.trim() || humanizeAgentName(input.agentName),
            agentName: input.agentName,
            status: "queued",
            prompt: input.prompt,
        });
        ticket.updatedAt = new Date().toISOString();
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-step-planned",
            message: `${normalized.title} planned next step: ${input.title} (@${input.agentName})`,
            ticketId: normalized.id,
            agentName: input.agentName,
        });
        return normalized;
    }
    /** Persist user steering text so future steps can be shaped without reopening prompts manually. */
    async setTicketSteering(ticketId, steeringNote) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const trimmed = steeringNote.trim();
        const ticket = {
            ...tickets[ticketIndex],
            steeringNote: trimmed || undefined,
            updatedAt: new Date().toISOString(),
        };
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-steering-updated",
            message: trimmed
                ? `${normalized.title} saved user steering`
                : `${normalized.title} cleared user steering`,
            ticketId: normalized.id,
        });
        return normalized;
    }
    /** Move the ticket into a user-review gate instead of auto-closing it. */
    async requestTicketClosure(ticketId, summary) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const now = new Date().toISOString();
        const ticket = {
            ...tickets[ticketIndex],
            closureRequestedAt: now,
            closureAcceptedAt: undefined,
            closureSummary: summary?.trim() || tickets[ticketIndex].closureSummary,
            updatedAt: now,
        };
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-closure-requested",
            message: `${normalized.title} is awaiting user acceptance before closing`,
            ticketId: normalized.id,
        });
        return normalized;
    }
    /** User-approved terminal close. Only this transitions an all-done ticket into Done. */
    async acceptTicketClosure(ticketId) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const now = new Date().toISOString();
        const ticket = {
            ...tickets[ticketIndex],
            closureRequestedAt: tickets[ticketIndex].closureRequestedAt || now,
            closureAcceptedAt: now,
            updatedAt: now,
        };
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-closure-accepted",
            message: `${normalized.title} was accepted and closed by the user`,
            ticketId: normalized.id,
        });
        return normalized;
    }
    /** Re-open a ticket after the user steers it instead of accepting closure. */
    async reopenTicket(ticketId) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = {
            ...tickets[ticketIndex],
            closureRequestedAt: undefined,
            closureAcceptedAt: undefined,
            updatedAt: new Date().toISOString(),
        };
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-reopened",
            message: `${normalized.title} reopened for another steering pass`,
            ticketId: normalized.id,
        });
        return normalized;
    }
    /** Toggle a ticket's per-ticket continuous-mode override. */
    async setTicketContinuousMode(ticketId, enabled) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = { ...tickets[ticketIndex], continuousMode: enabled };
        ticket.updatedAt = new Date().toISOString();
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-continuous-mode-toggled",
            message: `${normalized.title} continuous mode ${enabled ? "on" : "off"}`,
            ticketId: normalized.id,
        });
        return normalized;
    }
    /**
     * v1.3.0 — toggle whether a ticket is run autonomously through the LM API
     * (no Copilot Chat paste required).
     */
    async setTicketAutonomousMode(ticketId, enabled) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const ticket = { ...tickets[ticketIndex], autonomousMode: enabled };
        ticket.updatedAt = new Date().toISOString();
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-autonomous-mode-toggled",
            message: `${normalized.title} autonomous mode ${enabled ? "on" : "off"}`,
            ticketId: normalized.id,
        });
        return normalized;
    }
    /**
     * Spawn a parallel side-chat lane on a ticket so a second agent can work in
     * its own chat tab without blocking the main sequential timeline.
     */
    async spawnParallelLane(ticketId, input) {
        const tickets = this.getTickets();
        const ticketIndex = tickets.findIndex((ticket) => ticket.id === ticketId);
        if (ticketIndex < 0)
            return undefined;
        const now = new Date().toISOString();
        const lane = {
            id: makeId("lane"),
            label: input.label?.trim() || `Parallel @${input.agentName}`,
            agentName: input.agentName,
            status: "active",
            prompt: input.prompt,
            createdAt: now,
            updatedAt: now,
        };
        const ticket = {
            ...tickets[ticketIndex],
            lanes: [...(tickets[ticketIndex].lanes ?? []), lane],
            updatedAt: now,
        };
        const normalized = normalizeTicket(ticket);
        tickets[ticketIndex] = normalized;
        await this.context.workspaceState.update(TICKETS_KEY, tickets);
        await this.recordEvent({
            type: "ticket-parallel-lane-spawned",
            message: `${normalized.title} spawned parallel lane @${input.agentName}`,
            ticketId: normalized.id,
            agentName: input.agentName,
        });
        return { ticket: normalized, lane };
    }
    async configureUsage(input) {
        const current = this.getUsage();
        const next = {
            ...current,
            planId: input.planId,
            planLabel: input.planLabel,
            monthlyQuota: input.monthlyQuota,
            trackingMode: input.trackingMode ?? current.trackingMode,
            estimatedUsedPremium: input.baselinePremiumUsed ?? current.estimatedUsedPremium,
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
    async recordAgentLaunch(input) {
        const current = this.getUsage();
        const deltaPremium = estimateModelMultiplier(input.model);
        const deltaTokens = estimatePromptTokens(input.promptText);
        const next = {
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
    async recordEvent(event) {
        const activity = this.getActivity();
        const next = [
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
    getSnapshot(agents) {
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
            awaitingAcceptance: tickets.filter((ticket) => Boolean(ticket.closureRequestedAt) && !ticket.closureAcceptedAt).length,
        };
        const queue = tickets
            .map((ticket) => {
            // Prefer awaiting-output / active so the queue surfaces the manager's
            // current attention point before any still-queued step.
            const step = ticket.steps.find((candidate) => candidate.status === "awaiting-output") ||
                ticket.steps.find((candidate) => candidate.status === "active") ||
                ticket.steps.find((candidate) => candidate.status === "queued");
            if (!step)
                return undefined;
            return {
                ticketId: ticket.id,
                ticketTitle: ticket.title,
                stepTitle: step.title,
                agentName: step.agentName,
                status: step.status,
            };
        })
            .filter((item) => item !== undefined);
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
                if (leftOrder !== rightOrder)
                    return leftOrder - rightOrder;
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
exports.AgentOpsStore = AgentOpsStore;
//# sourceMappingURL=state.js.map