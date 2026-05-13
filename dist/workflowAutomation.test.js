"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const workflowAutomation_1 = require("./workflowAutomation");
// The queue button label communicates exactly what the next click will do.
// When auto-proceed is on, an active step needs the user to submit the chat
// output so the manager can advance; when off, the user just marks the step
// done manually without auto-launching the next agent.
(0, node_test_1.default)("queue label asks for output when auto proceed is enabled on active step", () => {
    const label = (0, workflowAutomation_1.getQueueActionLabel)({
        status: "active",
        autoProceedEnabled: true,
    });
    strict_1.default.equal(label, "Submit Output + Advance");
});
(0, node_test_1.default)("queue label falls back to manual completion when auto proceed is disabled", () => {
    const label = (0, workflowAutomation_1.getQueueActionLabel)({
        status: "active",
        autoProceedEnabled: false,
    });
    strict_1.default.equal(label, "Mark Step Complete");
});
(0, node_test_1.default)("queue label always asks for output when step is awaiting-output", () => {
    const label = (0, workflowAutomation_1.getQueueActionLabel)({
        status: "awaiting-output",
        autoProceedEnabled: false,
    });
    strict_1.default.equal(label, "Submit Output + Advance");
});
(0, node_test_1.default)("automatic handoff summary still includes workflow result and next agent", () => {
    const summary = (0, workflowAutomation_1.buildAutomaticHandoffSummary)({
        stepTitle: "Build",
        agentName: "test-driven-development",
        nextAgentName: "requesting-code-review",
        workflowResult: "Implemented tests and code for queue automation.",
    });
    strict_1.default.match(summary, /Build/);
    strict_1.default.match(summary, /@test-driven-development/);
    strict_1.default.match(summary, /Implemented tests and code for queue automation\./);
    strict_1.default.match(summary, /@requesting-code-review/);
});
(0, node_test_1.default)("auto proceed refuses to advance until output is captured", () => {
    strict_1.default.equal((0, workflowAutomation_1.shouldAutoProceedWorkflow)({
        autoProceedEnabled: true,
        hasQueuedNextStep: true,
        hasCapturedOutput: false,
    }), false);
    strict_1.default.equal((0, workflowAutomation_1.shouldAutoProceedWorkflow)({
        autoProceedEnabled: true,
        hasQueuedNextStep: true,
        hasCapturedOutput: true,
    }), true);
    strict_1.default.equal((0, workflowAutomation_1.shouldAutoProceedWorkflow)({
        autoProceedEnabled: true,
        hasQueuedNextStep: false,
    }), false);
});
(0, node_test_1.default)("manager analysis extracts key points and headlines from chat output", () => {
    const analysis = (0, workflowAutomation_1.analyzeStepOutput)({
        output: "- Found root cause in retry loop\n- Added regression test\n- Why does the proxy retry on 502?",
        stepTitle: "Diagnose",
        agentName: "systematic-debugging",
        nextAgentName: "subagent-driven-development",
        nextStepTitle: "Coordinate Fix",
    });
    strict_1.default.match(analysis.headline, /systematic-debugging/);
    strict_1.default.equal(analysis.keyPoints.length, 3);
    strict_1.default.equal(analysis.openQuestions[0], "Why does the proxy retry on 502?");
    strict_1.default.match(analysis.fullText, /Hand off to @subagent-driven-development/);
});
(0, node_test_1.default)("manager analysis handles empty output by flagging the gap", () => {
    const analysis = (0, workflowAutomation_1.analyzeStepOutput)({
        output: "   ",
        stepTitle: "Plan",
        agentName: "writing-plans",
    });
    strict_1.default.match(analysis.headline, /no captured output/);
    strict_1.default.equal(analysis.keyPoints.length, 0);
    strict_1.default.equal(analysis.openQuestions.length, 1);
});
(0, node_test_1.default)("structured handoff prompt quotes prior chat output verbatim", () => {
    const prompt = (0, workflowAutomation_1.buildStructuredHandoffPrompt)({
        ticketTitle: "Wire automation",
        workspaceLabel: "Workspace",
        originalRequest: "Build manager-mediated workflow",
        priorSteps: [
            {
                title: "Diagnose",
                agentName: "systematic-debugging",
                summary: "Root cause located",
                analysis: "Key points: retry loop",
                output: "raw chat text from systematic-debugging",
            },
        ],
        currentStepTitle: "Coordinate Fix",
        currentAgentName: "subagent-driven-development",
    });
    strict_1.default.match(prompt, /@subagent-driven-development/);
    strict_1.default.match(prompt, /Wire automation/);
    strict_1.default.match(prompt, /raw chat text from systematic-debugging/);
    strict_1.default.match(prompt, /paste your full response back into the Agent Manager/);
});
//# sourceMappingURL=workflowAutomation.test.js.map