---
name: kanban
description: Move this thread's card on the Kanban board as work progresses, and read the board when coordinating other threads. Use whenever you start, hand over for review, finish, or get blocked on a task, or when the user asks about the board.
---

# Kanban board

Every bb thread can be a card on the Kanban board (the **Kanban** page in the
sidebar). Columns, in order: `backlog`, `in-progress`, `review`, `done`.
New threads join Backlog automatically and move to In progress when they
start running. After that, **you** move the card.

## When to move your card

| Moment | Column | Note to attach |
| --- | --- | --- |
| You begin substantive work | `in-progress` | What you are doing |
| Output is ready for the user to check, or you are blocked on them | `review` | What to look at, or what you need |
| The request is complete | `done` | One-line summary |
| Work is parked or deprioritised | `backlog` | Why |

## How to move it

Prefer the native tool when it is available:

```
kanban_move { "column": "review", "note": "PR #42 ready — needs a look at the migration" }
```

From a shell, the CLI does the same and works for any provider:

```
bb kanban move review --note "PR #42 ready — needs a look at the migration"
bb kanban board                 # every card in this project
bb kanban board --project all   # every project
bb kanban move done --thread thr_abc123 --note "merged"
bb kanban history               # this thread's column history
```

Add `--json` when the output drives code. Aliases such as `doing`, `wip`,
`complete` resolve to the right column.

## Rules

- Move the card only when the state genuinely changed; do not churn it.
- Always attach a short note: the user reads the card, not your transcript.
- When you orchestrate child threads, move **their** cards with `--thread`
  / `threadId` as they progress, and read `kanban_board` before reporting.
- Do not edit the plugin's database directly.
