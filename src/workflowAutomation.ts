import { WorkflowStepStatus } from "./state";

export function getQueueActionLabel(input: {
  status: WorkflowStepStatus;
  autoProceedEnabled: boolean;
}): string {
  if (input.status === "active") {
    return input.autoProceedEnabled ? "Complete + Next" : "Complete Step";
  }

  return "Run Step";
}

export function shouldAutoProceedWorkflow(input: {
  autoProceedEnabled: boolean;
  hasQueuedNextStep: boolean;
}): boolean {
  return input.autoProceedEnabled && input.hasQueuedNextStep;
}

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
