// v1.2.0 — LLM-driven workflow manager.
//
// The manager uses the VS Code Language Model API (vscode.lm) to (a) plan the
// next workflow step from the ORIGINAL request + the verbatim outputs of all
// prior steps, and (b) compose a tailored per-step instruction set for the
// next agent. There is NO regex fallback for output parsing — the manager is
// LLM-driven the entire way per user requirement. If no LM is available we
// surface that error and stop the workflow rather than silently regressing
// to the old heuristic path.
//
// All planning happens AFTER the prior step's chat output has been captured.
// The manager never queues more than one step ahead of itself.

import * as vscode from "vscode";

export interface PriorStepRecord {
  title: string;
  agentName: string;
  output?: string;
  summary?: string;
}

export interface PlannedNextStep {
  done: boolean;
  /** When done=false, the agent that should run the next step. */
  agentName?: string;
  /** Short title shown on the queue card. */
  stepTitle?: string;
  /** Tailored instruction set the manager wants this agent to follow. */
  customPrompt?: string;
  /** Optional acceptance criteria the next agent must satisfy. */
  acceptanceCriteria?: string[];
  /** Brief rationale for transparency. */
  rationale?: string;
}

const PLANNER_SYSTEM = `You are the Agent Manager for a Copilot multi-agent ticket system.
Given an original user request, the available specialist agents, and the FULL
verbatim chat output of every prior step, decide whether the workflow is done
or what the SINGLE next step should be.

Hard rules:
- Plan exactly ONE next step at a time. Never list a sequence.
- The next step's customPrompt must be tailored to the work that already happened.
  Quote concrete artifacts, file names, decisions, or open questions from the
  prior outputs verbatim. Do not paraphrase.
- Respect each agent's specialty. Pick the most appropriate available agent.
- Set done=true only when the original request is fully and verifiably satisfied
  by prior outputs (including verification, if relevant). Otherwise done=false.
- customPrompt MUST start with "@<agentName>" on its own line and end with a
  clear request for the agent to paste its full response back into the Agent
  Manager queue when finished.

Reply with ONLY a single JSON object, no prose, no fences:
{
  "done": boolean,
  "agentName": string | null,
  "stepTitle": string | null,
  "customPrompt": string | null,
  "acceptanceCriteria": string[] | null,
  "rationale": string | null
}`;

function buildPlannerUserPrompt(input: {
  originalRequest: string;
  ticketTitle: string;
  workspaceLabel: string;
  availableAgents: Array<{ name: string; description?: string }>;
  priorSteps: PriorStepRecord[];
}): string {
  const agentList = input.availableAgents.length
    ? input.availableAgents
        .map((agent) => `- @${agent.name}${agent.description ? ` — ${agent.description}` : ""}`)
        .join("\n")
    : "- @brainstorming\n- @writing-plans\n- @subagent-driven-development\n- @verification-before-completion";

  const priorSection = input.priorSteps.length
    ? input.priorSteps
        .map((step, index) => {
          const out = step.output?.trim() || "(no captured output)";
          const truncated = out.length > 6000 ? `${out.slice(0, 6000)}\n... [truncated]` : out;
          return [
            `### Prior step ${index + 1}: ${step.title} (@${step.agentName})`,
            step.summary ? `Summary: ${step.summary}` : "",
            "Verbatim output:",
            "```",
            truncated,
            "```",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n---\n\n")
    : "_No prior steps yet._";

  return [
    `# Ticket: ${input.ticketTitle}`,
    `Workspace: ${input.workspaceLabel}`,
    `Original request:\n${input.originalRequest}`,
    `## Available agents\n${agentList}`,
    `## Prior chain\n${priorSection}`,
    `## Decide the next single step now. Respond with JSON only.`,
  ].join("\n\n");
}

function tryParsePlannerJson(text: string): PlannedNextStep | undefined {
  const trimmed = text.trim();
  // Strip markdown fences if the model added them despite instructions.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  // Find the outermost JSON object.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  const done = obj.done === true;
  const agentName = typeof obj.agentName === "string" ? obj.agentName.replace(/^@/, "").trim() : undefined;
  const stepTitle = typeof obj.stepTitle === "string" ? obj.stepTitle.trim() : undefined;
  const customPrompt = typeof obj.customPrompt === "string" ? obj.customPrompt.trim() : undefined;
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : undefined;
  const acceptanceCriteria = Array.isArray(obj.acceptanceCriteria)
    ? obj.acceptanceCriteria.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;

  if (done) return { done: true, rationale };
  if (!agentName || !customPrompt) return undefined;
  return {
    done: false,
    agentName,
    stepTitle: stepTitle || agentName,
    customPrompt,
    acceptanceCriteria,
    rationale,
  };
}

async function selectModel(): Promise<vscode.LanguageModelChat | undefined> {
  // Prefer Copilot models — they're available to anyone with a Copilot
  // subscription and don't require extra wiring.
  const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
  if (!lm || typeof lm.selectChatModels !== "function") return undefined;
  try {
    const copilot = await lm.selectChatModels({ vendor: "copilot" });
    if (copilot.length > 0) return copilot[0];
    const any = await lm.selectChatModels({});
    return any[0];
  } catch {
    return undefined;
  }
}

export interface PlanNextStepInput {
  originalRequest: string;
  ticketTitle: string;
  workspaceLabel: string;
  availableAgents: Array<{ name: string; description?: string }>;
  priorSteps: PriorStepRecord[];
  cancellationToken?: vscode.CancellationToken;
}

export type PlanNextStepResult =
  | { kind: "planned"; step: PlannedNextStep }
  | { kind: "done"; rationale?: string }
  | { kind: "no-model" }
  | { kind: "parse-error"; rawText: string }
  | { kind: "lm-error"; error: string };

/**
 * Ask the Copilot LM to decide the single next step. Returns a discriminated
 * result so the caller can surface clear UI when no model is available
 * instead of silently advancing on heuristics.
 */
export async function planNextStep(input: PlanNextStepInput): Promise<PlanNextStepResult> {
  const model = await selectModel();
  if (!model) return { kind: "no-model" };

  const messages = [
    vscode.LanguageModelChatMessage.User(`${PLANNER_SYSTEM}\n\n${buildPlannerUserPrompt(input)}`),
  ];

  let raw = "";
  try {
    const response = await model.sendRequest(
      messages,
      {},
      input.cancellationToken ?? new vscode.CancellationTokenSource().token
    );
    for await (const chunk of response.text) {
      raw += chunk;
    }
  } catch (error) {
    return { kind: "lm-error", error: error instanceof Error ? error.message : String(error) };
  }

  const parsed = tryParsePlannerJson(raw);
  if (!parsed) return { kind: "parse-error", rawText: raw };
  if (parsed.done) return { kind: "done", rationale: parsed.rationale };
  return { kind: "planned", step: parsed };
}

/**
 * Ask the LM to produce a structured analysis of the prior step's output. Used
 * by the dashboard to render a manager-analysis preview. JSON-only contract.
 */
export interface StepAnalysis {
  headline: string;
  keyPoints: string[];
  openQuestions: string[];
  artifacts: Array<{ path: string; note?: string }>;
}

const ANALYZER_SYSTEM = `You are the Agent Manager analyzing a single agent's chat output.
Extract a short structured summary so the next agent can build on it.
Reply with ONLY a single JSON object, no prose, no fences:
{
  "headline": string,
  "keyPoints": string[],
  "openQuestions": string[],
  "artifacts": [{ "path": string, "note": string | null }]
}`;

function tryParseAnalysisJson(text: string): StepAnalysis | undefined {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  const headline = typeof obj.headline === "string" ? obj.headline.trim() : "";
  const keyPoints = Array.isArray(obj.keyPoints)
    ? obj.keyPoints.filter((item): item is string => typeof item === "string")
    : [];
  const openQuestions = Array.isArray(obj.openQuestions)
    ? obj.openQuestions.filter((item): item is string => typeof item === "string")
    : [];
  const artifactsRaw = Array.isArray(obj.artifacts) ? obj.artifacts : [];
  const artifacts: Array<{ path: string; note?: string }> = [];
  for (const entry of artifactsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const path = typeof e.path === "string" ? e.path : undefined;
    if (!path) continue;
    const note = typeof e.note === "string" ? e.note : undefined;
    artifacts.push(note ? { path, note } : { path });
  }
  if (!headline) return undefined;
  return { headline, keyPoints, openQuestions, artifacts };
}

export type AnalyzeStepResult =
  | { kind: "analyzed"; analysis: StepAnalysis }
  | { kind: "no-model" }
  | { kind: "parse-error"; rawText: string }
  | { kind: "lm-error"; error: string };

export async function analyzeStepOutputWithLm(input: {
  output: string;
  stepTitle: string;
  agentName: string;
  cancellationToken?: vscode.CancellationToken;
}): Promise<AnalyzeStepResult> {
  const model = await selectModel();
  if (!model) return { kind: "no-model" };

  const userPrompt = [
    `Step: ${input.stepTitle}`,
    `Agent: @${input.agentName}`,
    `Verbatim output:`,
    "```",
    input.output.length > 8000 ? `${input.output.slice(0, 8000)}\n... [truncated]` : input.output,
    "```",
    `Respond with JSON only.`,
  ].join("\n\n");

  let raw = "";
  try {
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(`${ANALYZER_SYSTEM}\n\n${userPrompt}`)],
      {},
      input.cancellationToken ?? new vscode.CancellationTokenSource().token
    );
    for await (const chunk of response.text) {
      raw += chunk;
    }
  } catch (error) {
    return { kind: "lm-error", error: error instanceof Error ? error.message : String(error) };
  }
  const parsed = tryParseAnalysisJson(raw);
  if (!parsed) return { kind: "parse-error", rawText: raw };
  return { kind: "analyzed", analysis: parsed };
}

export function formatAnalysisAsMarkdown(analysis: StepAnalysis): string {
  const parts: string[] = [analysis.headline];
  if (analysis.keyPoints.length) {
    parts.push(`**Key points:**\n${analysis.keyPoints.map((point) => `- ${point}`).join("\n")}`);
  }
  if (analysis.openQuestions.length) {
    parts.push(`**Open questions:**\n${analysis.openQuestions.map((question) => `- ${question}`).join("\n")}`);
  }
  if (analysis.artifacts.length) {
    parts.push(
      `**Artifacts:**\n${analysis.artifacts
        .map((artifact) => `- \`${artifact.path}\`${artifact.note ? ` — ${artifact.note}` : ""}`)
        .join("\n")}`
    );
  }
  return parts.join("\n\n");
}

// Exposed only for tests.
export const __test__ = { tryParsePlannerJson, tryParseAnalysisJson, buildPlannerUserPrompt };
