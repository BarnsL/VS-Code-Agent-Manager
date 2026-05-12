# Agent Activity And Usage Telemetry

## Purpose

This document explains how the extension exposes real-time agent execution state in the left sidebar and how premium usage estimates are tracked and surfaced in the status bar tooltip.

## Left Sidebar: Agent Activity View

The extension contributes a dedicated tree view: `copilot-agents.activity`.

The view is organized into three operational groups:

1. `Active Now`: One row per ticket currently running an `active` step.
2. `Queued Next`: One row per ticket with no active step but at least one queued step.
3. `Recent Agent Events`: Recent activity events that include an `agentName`.

### Row Behavior

- `Active Now` rows call `copilot-agents.completeTicketStep` with the owning ticket id.
- `Queued Next` rows call `copilot-agents.runTicketStep` with the owning ticket id.
- `Recent Agent Events` rows call `copilot-agents.openAgentByName`.

This mirrors an operations-first workflow: monitor current work, advance queued work, and inspect the responsible agent quickly.

## Snapshot Data Source

The activity view and dashboard both consume a common `DashboardSnapshot` from `AgentOpsStore.getSnapshot(...)`.

This gives all UI surfaces the same source of truth for:

- Ticket state and step status
- Agent counts
- Usage estimates
- Recent activity events

## Premium Usage Tracking Model

### Why Estimated Tracking Is Used

GitHub Copilot does not currently provide an extension API for live per-user premium remaining values.

The extension therefore tracks usage using local telemetry events and explicit user-configured quota.

### What Increments Usage

Usage increments on `recordAgentLaunch(...)`, which is called by:

- Route command launches (`source: route-command`)
- Chat participant routing (`source: chat-route`)
- Ticket step launches (`source: ticket-workflow`)
- Agent index launch action (`source: invoke-agent-command`)

The final item above closes a prior accounting gap where `Invoke in Chat` opened chat but did not increment estimated premium usage.

### Fast Accuracy Sync From Copilot UI

To align the status tooltip with VS Code's Copilot usage panel quickly, the extension now includes:

- Command: `Copilot Agents: Sync Usage From Copilot Panel`

Workflow:

1. Select plan (`Free`, `Pro`, `Pro+`, or `Custom`).
2. Enter `% used` from Copilot quick settings (for example `40%`).
3. Extension computes baseline used with:

`baselineUsed = round((percentUsed / 100) * monthlyQuota, 2)`

4. Baseline is persisted through `configureUsage(...)` and reflected in status tooltip immediately.

This command is intended for reconciliation when provider UI and local estimates diverge.

### Tooltip Fields

The status bar tooltip now reports:

- Plan label and monthly premium limit
- Estimated premium used
- Estimated premium remaining
- Last updated timestamp
- Tracking-source disclaimer

This makes quota interpretation explicit and avoids ambiguity about what is estimated versus provider-reported.

## Design Notes

- The activity view is read-only over snapshot state and emits command actions; it does not mutate state directly.
- Refresh fan-out (`refreshAll`) updates tree index, activity view, status bar, and dashboard together.
- The activity view intentionally shows only one current queued/active row per ticket to reduce visual noise.

## Validation Checklist

1. Invoke an agent from Agent Index and confirm status bar used/remaining updates immediately.
2. Create a ticket and launch a step; confirm step appears under `Active Now`.
3. Complete an active step; confirm it leaves `Active Now` and next step appears under `Queued Next`.
4. Confirm `Recent Agent Events` includes launch/step entries with agent names.
5. Run `Copilot Agents: Sync Usage From Copilot Panel` with `40%` on a `Pro+` plan and confirm tooltip reports approximately `600/1500` used (or equivalent based on input precision).
