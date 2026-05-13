import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAutomaticHandoffSummary,
  getQueueActionLabel,
  shouldAutoProceedWorkflow,
} from "./workflowAutomation";

test("workflow queue action shows auto proceed label when enabled", () => {
  const label = getQueueActionLabel({
    status: "active",
    autoProceedEnabled: true,
  });

  assert.equal(label, "Complete + Next");
});

test("workflow queue action keeps default label when auto proceed is disabled", () => {
  const label = getQueueActionLabel({
    status: "active",
    autoProceedEnabled: false,
  });

  assert.equal(label, "Complete Step");
});

test("automatic handoff summary includes workflow result and next agent", () => {
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

test("auto proceed requires active setting and a queued next step", () => {
  assert.equal(
    shouldAutoProceedWorkflow({
      autoProceedEnabled: true,
      hasQueuedNextStep: true,
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