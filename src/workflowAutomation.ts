import { WorkflowStepStatus } from "./state";

// ─── Queue button labels ─────────────────────────────────────────────────────

export function getQueueActionLabel(input: {
  status: WorkflowStepStatus;
  autoProceedEnabled: boolean;
}): string {
  if (input.status === "awaiting-output") {
    return "Submit Output + Advance";
  }
  if (input.status === "active") {
    return input.autoProceedEnabled ? "Submit Output + Advance" : "Mark Step Complete";
  }
  return "Run Step";
}

// ─── Auto-proceed gate ────────────────────────────────────────────────────────

export function shouldAutoProceedWorkflow(input: {
  autoProceedEnabled: boolean;
  hasQueuedNextStep: boolean;
  /** Manager only auto-advances once it has actual chat output to forward. */
  hasCapturedOutput?: boolean;
}): boolean {
  if (!input.autoProceedEnabled) return false;
  if (!input.hasQueuedNextStep) return false;
  // When a caller passes hasCapturedOutput=false explicitly we refuse to
  // advance \u2014 this is the safety net that prevents the old blind-loop bug
  // where step N+1 fired before step N's chat output was inspected.
  if (input.hasCapturedOutput === false) return false;
  return true;
}

// ─── Handoff summary (legacy auto-summary kept for backward compatibility) ───

export function buildAutomaticHandoffSummary(input: {
  stepTitle: string;
  agentName: string;
  nextAgentName?: string;
  workflowResult?: string;
}): string {
  const resultText = input.workflowResult?.trim()
    ? input.workflowResult.trim()
    : "Completed workflow step automatically from the queue.";
  const nextText = input.nextAgentName
    ? `Next: @${input.nextAgentName}`
    : "Next: Workflow complete";

  return [
    `${input.stepTitle} completed by @${input.agentName}.`,
    `Result: ${resultText}`,
    nextText,
  ].join(" ");
}

// ─── Manager analysis ────────────────────────────────────────────────────────
//
// The manager turns raw chat output into a short structured analysis that the
// next step prompt can quote verbatim. This is intentionally local and rule
// based \u2014 no LLM call \u2014 so it runs synchronously and never burns extra
// premium requests.

export interface StepOutputAnalysis {
  /** One-line takeaway suitable for inclusion in the next agent's prompt. */
  headline: string;
  /** Short bullet list extracted from the output. */
  keyPoints: string[];
  /** Open questions the next agent should resolve. */
  openQuestions: string[];
  /** Full structured paragraph stored on the completed step. */
  fullText: string;
}

const MAX_KEY_POINTS = 5;
const MAX_OPEN_QUESTIONS = 3;

export function analyzeStepOutput(input: {
  output: string;
  stepTitle: string;
  agentName: string;
  nextAgentName?: string;
  nextStepTitle?: string;
}): StepOutputAnalysis {
  const trimmed = input.output.trim();
  if (!trimmed) {
    const fallback = `@${input.agentName} produced no captured output for ${input.stepTitle}. The next agent should re-run or request the missing artifact.`;
    return {
      headline: fallback,
      keyPoints: [],
      openQuestions: ["No output captured \u2014 confirm the prior step actually ran."],
      fullText: fallback,
    };
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const keyPoints = lines
    .filter((line) => /^([-*\u2022]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^([-*\u2022]|\d+\.)\s+/, ""))
    .slice(0, MAX_KEY_POINTS);

  if (keyPoints.length === 0) {
    // Fall back to short sentences when the output isn't bulleted.
    const sentences = trimmed
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0 && sentence.length <= 220);
    keyPoints.push(...sentences.slice(0, MAX_KEY_POINTS));
  }

  const openQuestions = lines
    .map((line) => line.replace(/^([-*\u2022]|\d+\.)\s+/, ""))
    .filter((line) => line.endsWith("?"))
    .slice(0, MAX_OPEN_QUESTIONS);

  const headline = `@${input.agentName} finished ${input.stepTitle}. ${
    keyPoints[0] ?? trimmed.slice(0, 200)
  }`.replace(/\s+/g, " ").trim();

  const nextLine = input.nextAgentName
    ? `Hand off to @${input.nextAgentName}${input.nextStepTitle ? ` for ${input.nextStepTitle}` : ""}.`
    : "Workflow complete \u2014 no further agents queued.";

  const fullText = [
    headline,
    keyPoints.length
      ? `Key points:\n${keyPoints.map((point) => `- ${point}`).join("\n")}`
      : "",
    openQuestions.length
      ? `Open questions:\n${openQuestions.map((question) => `- ${question}`).join("\n")}`
      : "",
    nextLine,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    headline,
    keyPoints,
    openQuestions,
    fullText,
  };
}

// ─── Structured next-step prompt ─────────────────────────────────────────────
//
// The manager builds the next step's chat prompt by quoting the prior step's
// raw output verbatim and appending the analysis so the next agent always
// works from the actual deliverable instead of a synthesized summary.

export function buildStructuredHandoffPrompt(input: {
  ticketTitle: string;
  workspaceLabel: string;
  originalRequest: string;
  priorSteps: Array<{
    title: string;
    agentName: string;
    summary?: string;
    output?: string;
    analysis?: string;
  }>;
  currentStepTitle: string;
  currentAgentName: string;
}): string {
  const priorSection = input.priorSteps.length
    ? input.priorSteps
        .map((step, index) => {
          const parts: string[] = [
            `### Prior step ${index + 1}: ${step.title} (@${step.agentName})`,
          ];
          if (step.summary) parts.push(`**Handoff summary:** ${step.summary}`);
          if (step.analysis) parts.push(`**Manager analysis:**\n${step.analysis}`);
          if (step.output) {
            const trimmedOutput = step.output.length > 4000
              ? `${step.output.slice(0, 4000)}\n... [truncated to 4000 chars]`
              : step.output;
            parts.push(`**Raw chat output:**\n\n\`\`\`\n${trimmedOutput}\n\`\`\``);
          }
          return parts.join("\n\n");
        })
        .join("\n\n---\n\n")
    : "_No prior steps have run yet \u2014 you are the first agent on this ticket._";

  return [
    `@${input.currentAgentName}`,
    `Ticket: ${input.ticketTitle}`,
    `Workspace: ${input.workspaceLabel}`,
    `Original request: ${input.originalRequest}`,
    `## Prior chain`,
    priorSection,
    `## Your step: ${input.currentStepTitle}`,
    `Use the prior chat output above as ground truth. Do not invent prior results.`,
    `When you finish, paste your full response back into the Agent Manager Workflow Queue so the manager can analyze it and compose the next agent's prompt.`,
  ].join("\n\n");
}
