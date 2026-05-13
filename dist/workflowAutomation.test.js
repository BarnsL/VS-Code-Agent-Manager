"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const workflowAutomation_1 = require("./workflowAutomation");
(0, node_test_1.default)("workflow queue action shows auto proceed label when enabled", () => {
    const label = (0, workflowAutomation_1.getQueueActionLabel)({
        status: "active",
        autoProceedEnabled: true,
    });
    strict_1.default.equal(label, "Complete + Next");
});
(0, node_test_1.default)("workflow queue action keeps default label when auto proceed is disabled", () => {
    const label = (0, workflowAutomation_1.getQueueActionLabel)({
        status: "active",
        autoProceedEnabled: false,
    });
    strict_1.default.equal(label, "Complete Step");
});
(0, node_test_1.default)("automatic handoff summary includes workflow result and next agent", () => {
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
(0, node_test_1.default)("auto proceed requires active setting and a queued next step", () => {
    strict_1.default.equal((0, workflowAutomation_1.shouldAutoProceedWorkflow)({
        autoProceedEnabled: true,
        hasQueuedNextStep: true,
    }), true);
    strict_1.default.equal((0, workflowAutomation_1.shouldAutoProceedWorkflow)({
        autoProceedEnabled: true,
        hasQueuedNextStep: false,
    }), false);
});
//# sourceMappingURL=workflowAutomation.test.js.map