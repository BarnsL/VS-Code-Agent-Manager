import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeStepOutput,
  buildAutomaticHandoffSummary,
  buildStructuredHandoffPrompt,
  getQueueActionLabel,
  shouldAutoProceedWorkflow,
} from "./workflowAutomation";

// The queue button label communicates exactly what the next click will do.
// When auto-proceed is on, an active step needs the user to submit the chat
// output so the manager can advance; when off, the user just marks the step
// done manually without auto-launching the next agent.

test("queue label asks for output when auto proceed is enabled on active step", () => {
  const label = getQueueActionLabel({
    status: "active",
    autoProceedEnabled: true,
  });

  assert.equal(label, "Submit Output + Advance");
});

test("queue label falls back to manual completion when auto proceed is disabled", () => {
  const label = getQueueActionLabel({
    status: "active",
    autoProceedEnabled: false,
  });

  assert.equal(label, "Mark Step Complete");
});

test("queue label always asks for output when step is awaiting-output", () => {
  const label = getQueueActionLabel({
    status: "awaiting-output",
    autoProceedEnabled: false,
  });

  assert.equal(label, "Submit Output + Advance");
});

test("automatic handoff summary still includes workflow result and next agent", () => {
  const summary = buildAutomaticHandoffSummary({
    stepTitle: "Build",
    agentName: "test-driven-development",
    nextAgentName: "requesting-code-review",
    workflowResult: "Implemented tests and code for queue automation.",
  });

  assert.match(summary, /Build/);
  assert.match(summary, /@test-driven-development/);
  assert.match(summary, /Implemented tests and code for queue automation\./);
  assert.match(summary, /@requesting-code-review/);
});

test("auto proceed refuses to advance until output is captured", () => {
  assert.equal(
    shouldAutoProceedWorkflow({
      autoProceedEnabled: true,
      hasQueuedNextStep: true,
      hasCapturedOutput: false,
    }),
    false
  );

  assert.equal(
    shouldAutoProceedWorkflow({
      autoProceedEnabled: true,
      hasQueuedNextStep: true,
      hasCapturedOutput: true,
    }),
    true
  );

  assert.equal(
    shouldAutoProceedWorkflow({
      autoProceedEnabled: true,
      hasQueuedNextStep: false,
    }),
    false
  );
});

test("manager analysis extracts key points and headlines from chat output", () => {
  const analysis = analyzeStepOutput({
    output:
      "- Found root cause in retry loop\n- Added regression test\n- Why does the proxy retry on 502?",
    stepTitle: "Diagnose",
    agentName: "systematic-debugging",
    nextAgentName: "subagent-driven-development",
    nextStepTitle: "Coordinate Fix",
  });

  assert.match(analysis.headline, /systematic-debugging/);
  assert.equal(analysis.keyPoints.length, 3);
  assert.equal(analysis.openQuestions[0], "Why does the proxy retry on 502?");
  assert.match(analysis.fullText, /Hand off to @subagent-driven-development/);
});

test("manager analysis handles empty output by flagging the gap", () => {
  const analysis = analyzeStepOutput({
    output: "   ",
    stepTitle: "Plan",
    agentName: "writing-plans",
  });

  assert.match(analysis.headline, /no captured output/);
  assert.equal(analysis.keyPoints.length, 0);
  assert.equal(analysis.openQuestions.length, 1);
});

test("structured handoff prompt quotes prior chat output verbatim", () => {
  const prompt = buildStructuredHandoffPrompt({
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

  assert.match(prompt, /@subagent-driven-development/);
  assert.match(prompt, /Wire automation/);
  assert.match(prompt, /raw chat text from systematic-debugging/);
  assert.match(prompt, /paste your full response back into the Agent Manager/);
});
