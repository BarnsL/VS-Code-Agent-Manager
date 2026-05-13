"use strict";
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
exports.__test__ = void 0;
exports.planNextStep = planNextStep;
exports.analyzeStepOutputWithLm = analyzeStepOutputWithLm;
exports.formatAnalysisAsMarkdown = formatAnalysisAsMarkdown;
exports.runStepAutonomously = runStepAutonomously;
const vscode = __importStar(require("vscode"));
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
- Never return done=true if the request is implementation-heavy (build/create/
  scaffold/fix/refactor/code changes) unless prior outputs include concrete
  repository artifacts (file paths, test/build results, or verification steps).
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
function buildPlannerUserPrompt(input) {
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
            const analysis = step.analysis?.trim() || "";
            const truncatedAnalysis = analysis.length > 3000 ? `${analysis.slice(0, 3000)}\n... [truncated]` : analysis;
            return [
                `### Prior step ${index + 1}: ${step.title} (@${step.agentName})`,
                step.summary ? `Summary: ${step.summary}` : "",
                "Verbatim output:",
                "```",
                truncated,
                "```",
                truncatedAnalysis ? `Manager analysis:\n${truncatedAnalysis}` : "",
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
function tryParsePlannerJson(text) {
    const trimmed = text.trim();
    // Strip markdown fences if the model added them despite instructions.
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = fenceMatch ? fenceMatch[1] : trimmed;
    // Find the outermost JSON object.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(candidate.slice(start, end + 1));
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const obj = parsed;
    const done = obj.done === true;
    const agentName = typeof obj.agentName === "string" ? obj.agentName.replace(/^@/, "").trim() : undefined;
    const stepTitle = typeof obj.stepTitle === "string" ? obj.stepTitle.trim() : undefined;
    const customPrompt = typeof obj.customPrompt === "string" ? obj.customPrompt.trim() : undefined;
    const rationale = typeof obj.rationale === "string" ? obj.rationale.trim() : undefined;
    const acceptanceCriteria = Array.isArray(obj.acceptanceCriteria)
        ? obj.acceptanceCriteria.filter((item) => typeof item === "string" && item.trim().length > 0)
        : undefined;
    if (done)
        return { done: true, rationale };
    if (!agentName || !customPrompt)
        return undefined;
    return {
        done: false,
        agentName,
        stepTitle: stepTitle || agentName,
        customPrompt,
        acceptanceCriteria,
        rationale,
    };
}
async function selectModel() {
    // Prefer Copilot models — they're available to anyone with a Copilot
    // subscription and don't require extra wiring.
    const lm = vscode.lm;
    if (!lm || typeof lm.selectChatModels !== "function")
        return undefined;
    try {
        const copilot = await lm.selectChatModels({ vendor: "copilot" });
        if (copilot.length > 0)
            return copilot[0];
        const any = await lm.selectChatModels({});
        return any[0];
    }
    catch {
        return undefined;
    }
}
/**
 * Ask the Copilot LM to decide the single next step. Returns a discriminated
 * result so the caller can surface clear UI when no model is available
 * instead of silently advancing on heuristics.
 */
async function planNextStep(input) {
    const model = await selectModel();
    if (!model)
        return { kind: "no-model" };
    const messages = [
        vscode.LanguageModelChatMessage.User(`${PLANNER_SYSTEM}\n\n${buildPlannerUserPrompt(input)}`),
    ];
    let raw = "";
    try {
        const response = await model.sendRequest(messages, {}, input.cancellationToken ?? new vscode.CancellationTokenSource().token);
        for await (const chunk of response.text) {
            raw += chunk;
        }
    }
    catch (error) {
        return { kind: "lm-error", error: error instanceof Error ? error.message : String(error) };
    }
    const parsed = tryParsePlannerJson(raw);
    if (!parsed)
        return { kind: "parse-error", rawText: raw };
    if (parsed.done)
        return { kind: "done", rationale: parsed.rationale };
    return { kind: "planned", step: parsed };
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
function tryParseAnalysisJson(text) {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = fenceMatch ? fenceMatch[1] : trimmed;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(candidate.slice(start, end + 1));
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const obj = parsed;
    const headline = typeof obj.headline === "string" ? obj.headline.trim() : "";
    const keyPoints = Array.isArray(obj.keyPoints)
        ? obj.keyPoints.filter((item) => typeof item === "string")
        : [];
    const openQuestions = Array.isArray(obj.openQuestions)
        ? obj.openQuestions.filter((item) => typeof item === "string")
        : [];
    const artifactsRaw = Array.isArray(obj.artifacts) ? obj.artifacts : [];
    const artifacts = [];
    for (const entry of artifactsRaw) {
        if (!entry || typeof entry !== "object")
            continue;
        const e = entry;
        const path = typeof e.path === "string" ? e.path : undefined;
        if (!path)
            continue;
        const note = typeof e.note === "string" ? e.note : undefined;
        artifacts.push(note ? { path, note } : { path });
    }
    if (!headline)
        return undefined;
    return { headline, keyPoints, openQuestions, artifacts };
}
async function analyzeStepOutputWithLm(input) {
    const model = await selectModel();
    if (!model)
        return { kind: "no-model" };
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
        const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(`${ANALYZER_SYSTEM}\n\n${userPrompt}`)], {}, input.cancellationToken ?? new vscode.CancellationTokenSource().token);
        for await (const chunk of response.text) {
            raw += chunk;
        }
    }
    catch (error) {
        return { kind: "lm-error", error: error instanceof Error ? error.message : String(error) };
    }
    const parsed = tryParseAnalysisJson(raw);
    if (!parsed)
        return { kind: "parse-error", rawText: raw };
    return { kind: "analyzed", analysis: parsed };
}
function formatAnalysisAsMarkdown(analysis) {
    const parts = [analysis.headline];
    if (analysis.keyPoints.length) {
        parts.push(`**Key points:**\n${analysis.keyPoints.map((point) => `- ${point}`).join("\n")}`);
    }
    if (analysis.openQuestions.length) {
        parts.push(`**Open questions:**\n${analysis.openQuestions.map((question) => `- ${question}`).join("\n")}`);
    }
    if (analysis.artifacts.length) {
        parts.push(`**Artifacts:**\n${analysis.artifacts
            .map((artifact) => `- \`${artifact.path}\`${artifact.note ? ` — ${artifact.note}` : ""}`)
            .join("\n")}`);
    }
    return parts.join("\n\n");
}
async function runStepAutonomously(input) {
    const model = await selectModel();
    if (!model)
        return { kind: "no-model" };
    const systemPreamble = [
        `You are acting as the @${input.agentName} agent in a Copilot multi-agent ticket system.`,
        `Follow the instructions defined in your agent definition below verbatim.`,
        `Your response will be captured by the Agent Manager and forwarded to the next agent in the workflow,`,
        `so produce a complete, self-contained response. Do NOT ask clarifying questions back \u2014 make the best`,
        `decision you can with the information given and state your assumptions explicitly.`,
        input.agentBody ? `\n## Agent definition (@${input.agentName})\n${input.agentBody.trim()}` : "",
    ]
        .filter(Boolean)
        .join("\n");
    const messages = [
        vscode.LanguageModelChatMessage.User(`${systemPreamble}\n\n---\n\n${input.prompt}`),
    ];
    let raw = "";
    try {
        const response = await model.sendRequest(messages, {}, input.cancellationToken ?? new vscode.CancellationTokenSource().token);
        for await (const chunk of response.text) {
            raw += chunk;
            input.onChunk?.(chunk);
        }
    }
    catch (error) {
        return { kind: "lm-error", error: error instanceof Error ? error.message : String(error) };
    }
    const trimmed = raw.trim();
    if (!trimmed)
        return { kind: "lm-error", error: "Empty response from language model." };
    return { kind: "completed", output: trimmed };
}
// Exposed only for tests.
exports.__test__ = { tryParsePlannerJson, tryParseAnalysisJson, buildPlannerUserPrompt };
//# sourceMappingURL=managerLlm.js.map