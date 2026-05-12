"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_FEATURE_TICKETS = void 0;
// Product-level backlog for the exact capabilities requested:
// 1) automatic agent assignment, 2) chat-centric orchestration,
// 3) task ticketing that runs until complete.
exports.REQUIRED_FEATURE_TICKETS = [
    {
        id: "AM-001",
        title: "Automatic Agent Assignment Engine",
        requestedFeature: "Automatically assign the best agent(s) for each incoming task.",
        prompt: "Build and verify automatic agent assignment for every new task. Use routing signals from task text and chat context, store why each assignment was made, and show assignment confidence in the dashboard.",
    },
    {
        id: "AM-002",
        title: "Chat-First Orchestration And Handoffs",
        requestedFeature: "Manage jobs from chat and hand off work between agents automatically.",
        prompt: "Implement chat-first orchestration so users can create and advance jobs from chat. Add explicit handoff packets between agents, preserve prior step context, and provide one-click continue actions for the next assigned agent.",
    },
    {
        id: "AM-003",
        title: "Persistent Ticket Lifecycle Until Completed",
        requestedFeature: "Ticket system for specific tasks that remains active until completion.",
        prompt: "Implement durable ticket lifecycle controls for specific tasks: new, triaged, working, review, blocked, done. Add owner agent, due-date optional metadata, and completion criteria so tickets cannot be marked done until criteria are satisfied.",
    },
    {
        id: "AM-004",
        title: "Retry, Escalation, And Recovery Policies",
        requestedFeature: "Ensure tasks continue safely when an assigned agent stalls or fails.",
        prompt: "Add retry and escalation policies for stalled ticket steps. Detect no-progress loops, re-route to a fallback agent when needed, and record the full decision trail in activity logs.",
    },
    {
        id: "AM-005",
        title: "Completion Verification Gate",
        requestedFeature: "Require verification before final completion of each job.",
        prompt: "Enforce a completion gate that runs verification-before-completion for every ticket. Block final completion unless required checks pass and a verification summary is attached to the ticket history.",
    },
];
//# sourceMappingURL=roadmap.js.map