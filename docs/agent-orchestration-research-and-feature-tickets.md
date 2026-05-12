# Agent Orchestration Research And Feature Tickets

## Goal

Build a VS Code-native agent manager that:

1. Automatically assigns the right agent(s) to each job.
2. Orchestrates jobs from chat with structured handoffs.
3. Runs a ticket lifecycle for each specific task until it is completed.

## Online Implementations Reviewed

### 1) Continue (Mission Control + Agent Mode)
- Repo: https://github.com/continuedev/continue
- Why relevant:
  - Mission Control provides agent and task management patterns for cloud/local workflows.
  - Includes task-oriented operations, agent profiles, and multi-run monitoring concepts.
  - Distinguishes plan mode vs execute mode, useful for safe staged execution.
- Borrowable patterns:
  - Structured task entity with run logs and lifecycle status.
  - Tool policy controls by mode.
  - Separate orchestration UX from low-level tool execution.

### 2) Cline (Task history, planning, checkpoints, VS Code integration)
- Repo: https://github.com/cline/cline
- Why relevant:
  - Mature VS Code extension architecture with task sessions and operation timelines.
  - Strong examples of progress/checkpoint handling and session continuity.
- Borrowable patterns:
  - Persistent task state with resumable history.
  - Checkpoint and verification hooks before concluding work.
  - Explicit subagent/team event tracking.

### 3) AutoGen (Orchestrator-led multi-agent workflows)
- Repo: https://github.com/microsoft/autogen
- Why relevant:
  - Demonstrates orchestrator + worker models for assignment and completion loops.
  - Includes GroupChat/Swarm/GraphFlow patterns for deterministic or adaptive routing.
- Borrowable patterns:
  - Task ledger and progress ledger model.
  - Assignment traces (`who`, `why`, `result`) for each delegated step.
  - Retry/escalation logic when no progress is made.

### 4) OpenHands (Large-scale autonomous coding loops)
- Repo: https://github.com/OpenHands/OpenHands
- Why relevant:
  - End-to-end autonomous task execution with strong run-state and observability emphasis.
- Borrowable patterns:
  - Action logs and runtime state visibility.
  - Tight loop between execution and status updates.

## Feature Requirements (Explicit)

The following features are required and represented as tickets:

1. Automatic agent assignment for every new job.
2. Chat-first orchestration and handoff between agents.
3. Ticketing system for specific tasks that remains active until complete.
4. Retry/escalation path for stalled work.
5. Verification gate before final completion.

## Ticket Backlog (Created In Source)

These tickets are defined in source at `src/roadmap.ts` and can be seeded into the runtime ticket board using command:

`Copilot Agents: Seed Required Feature Tickets`

| Ticket | Title | Required Feature | Acceptance Focus |
|---|---|---|---|
| AM-001 | Automatic Agent Assignment Engine | Auto-assign best agent(s) per job | Assignment confidence and rationale captured and visible |
| AM-002 | Chat-First Orchestration And Handoffs | Manage work directly from chat with handoff packets | Next agent can continue with full prior context |
| AM-003 | Persistent Ticket Lifecycle Until Completed | Task-specific lifecycle from new to done | Completion blocked until criteria are met |
| AM-004 | Retry, Escalation, And Recovery Policies | Keep jobs moving when stalls happen | Fallback routing and escalation trail recorded |
| AM-005 | Completion Verification Gate | Verify before marking done | Verification summary required for closure |

## Implementation Notes In This Repository

- Source-backed ticket catalog added: `src/roadmap.ts`.
- New command added: `copilot-agents.seedRequiredFeatureTickets`.
- Command is exposed in `package.json` command contributions and command palette.
- Command behavior:
  - Creates missing roadmap tickets.
  - Skips duplicates by normalized title.
  - Refreshes dashboard and focuses the manager panel.

## How To Use

1. Open command palette.
2. Run `Copilot Agents: Seed Required Feature Tickets`.
3. Open Control Center.
4. Execute tickets in order AM-001 through AM-005.
