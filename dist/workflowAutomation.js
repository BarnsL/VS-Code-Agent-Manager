"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueActionLabel = getQueueActionLabel;
exports.shouldAutoProceedWorkflow = shouldAutoProceedWorkflow;
exports.buildAutomaticHandoffSummary = buildAutomaticHandoffSummary;
function getQueueActionLabel(input) {
    if (input.status === "active") {
        return input.autoProceedEnabled ? "Complete + Next" : "Complete Step";
    }
    return "Run Step";
}
function shouldAutoProceedWorkflow(input) {
    return input.autoProceedEnabled && input.hasQueuedNextStep;
}
function buildAutomaticHandoffSummary(input) {
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
//# sourceMappingURL=workflowAutomation.js.map