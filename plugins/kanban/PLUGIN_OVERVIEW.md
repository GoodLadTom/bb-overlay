# Kanban

A kanban board where every card is a thread. Open the **Kanban** page in the
sidebar to see your threads in four columns — Backlog, In progress, Review,
Done — and drag them between columns.

Agents move their own cards as work progresses using the `kanban_move` tool
or `bb kanban move <column>`, attaching a short status note so the board
reads as a live status wall rather than a list of thread titles. Orchestrating
agents can move their child threads' cards and read the whole board with
`kanban_board`.

Thread lifecycle keeps the board honest: new threads join Backlog, threads
that start running move to In progress, and archived or deleted threads leave
the board (or land in Done, if you prefer). Every column change is recorded,
so `bb kanban history` shows who moved a card and why.
