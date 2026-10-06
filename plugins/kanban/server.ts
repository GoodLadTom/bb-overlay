// bb-plugin-kanban — backend entry.
//
// A kanban board where every card is a bb thread. Cards live in the plugin's
// own SQLite database; agents move them with the `kanban_move` native tool or
// the `bb kanban` CLI; people drag them on the Kanban page. Thread lifecycle
// events keep the board honest (new threads join Backlog, running threads
// leave it, archived/deleted threads drop off).
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BoardStore,
  COLUMNS,
  COLUMN_IDS,
  MIGRATIONS,
  columnName,
  normaliseColumn,
  type Card,
  type ColumnId,
  type MovedBy,
} from "./board";

export type { Card, ColumnId, Move, MovedBy } from "./board";
export { COLUMNS } from "./board";

/** Realtime channel app.tsx listens on after any board write. */
export const BOARD_CHANGED = "board-changed";

const columnIdSchema = z.enum(COLUMN_IDS as [ColumnId, ...ColumnId[]]);
const threadIdSchema = z.string().trim().min(1).max(128);
const noteSchema = z.string().trim().max(500);
const movedBySchema = z.enum(["agent", "user", "system"]);

const cardSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  columnId: columnIdSchema,
  position: z.number(),
  note: z.string(),
  movedBy: movedBySchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

const moveSchema = z.object({
  id: z.number(),
  threadId: z.string(),
  fromColumn: columnIdSchema.nullable(),
  toColumn: columnIdSchema,
  movedBy: movedBySchema,
  note: z.string(),
  at: z.number(),
});

export const rpcContract = defineRpcContract({
  board_get: {
    input: z.object({ projectId: z.string().nullable().optional() }).strict(),
    output: z.object({
      columns: z.array(z.object({ id: columnIdSchema, name: z.string() })),
      cards: z.array(cardSchema),
    }),
  },
  card_add: {
    input: z
      .object({
        threadId: threadIdSchema,
        projectId: z.string().min(1),
        columnId: columnIdSchema.optional(),
      })
      .strict(),
    output: z.object({ card: cardSchema, created: z.boolean() }),
  },
  card_move: {
    input: z
      .object({
        threadId: threadIdSchema,
        columnId: columnIdSchema,
        beforeThreadId: threadIdSchema.nullable().optional(),
        afterThreadId: threadIdSchema.nullable().optional(),
        note: noteSchema.optional(),
      })
      .strict(),
    output: z.object({ card: cardSchema, changed: z.boolean() }),
  },
  card_remove: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
  card_history: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ moves: z.array(moveSchema) }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    autoAdd: {
      type: "boolean",
      label: "Add new threads to Backlog automatically",
      default: true,
    },
    autoStart: {
      type: "boolean",
      label: "Move a Backlog card to In progress when its thread starts running",
      default: true,
    },
    autoDoneOnArchive: {
      type: "boolean",
      label: "Move to Done when a thread is archived (otherwise the card is removed)",
      default: false,
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new BoardStore(db);

  function publish(): void {
    bb.realtime.publish(BOARD_CHANGED, { at: Date.now() });
  }

  /** Best-effort mirror of the column into the thread's plugin metadata so
   * other plugins and `bb thread` readers can see it. Never blocks a move. */
  async function mirror(threadId: string, columnId: ColumnId | null): Promise<void> {
    try {
      await bb.sdk.threads.updatePluginMetadata(
        columnId === null
          ? { threadId, remove: ["column"] }
          : { threadId, set: { column: columnId } },
      );
    } catch (cause) {
      bb.log.debug(
        `metadata mirror skipped for ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  async function addCard(
    threadId: string,
    projectId: string,
    columnId: ColumnId,
    movedBy: MovedBy,
  ) {
    const result = store.add(threadId, projectId, columnId, movedBy);
    if (result.created) {
      publish();
      await mirror(threadId, columnId);
    }
    return result;
  }

  async function moveCard(
    threadId: string,
    columnId: ColumnId,
    movedBy: MovedBy,
    options: { beforeThreadId?: string | null; afterThreadId?: string | null; note?: string } = {},
  ) {
    const result = store.move(threadId, columnId, movedBy, options);
    if (result !== null && result.changed) {
      publish();
      await mirror(threadId, columnId);
    }
    return result;
  }

  async function removeCard(threadId: string): Promise<boolean> {
    const removed = store.remove(threadId);
    if (removed) {
      publish();
      await mirror(threadId, null);
    }
    return removed;
  }

  async function resolveProjectId(threadId: string, fallback?: string): Promise<string> {
    if (fallback !== undefined && fallback !== "") return fallback;
    const thread = await bb.sdk.threads.get({ threadId });
    return thread.projectId;
  }

  // ---- RPC (the Kanban page) -------------------------------------------------
  bb.rpc.register(rpcContract, {
    board_get: ({ projectId }) => ({
      columns: COLUMNS.map((column) => ({ id: column.id, name: column.name })),
      cards: store.list(projectId ?? null),
    }),
    card_add: ({ threadId, projectId, columnId }) =>
      addCard(threadId, projectId, columnId ?? "backlog", "user"),
    card_move: async ({ threadId, columnId, beforeThreadId, afterThreadId, note }) => {
      const result = await moveCard(threadId, columnId, "user", {
        beforeThreadId,
        afterThreadId,
        note,
      });
      if (result === null) throw new Error(`Thread ${threadId} is not on the board`);
      return result;
    },
    card_remove: async ({ threadId }) => ({ removed: await removeCard(threadId) }),
    card_history: ({ threadId }) => ({ moves: store.history(threadId) }),
  });

  // ---- Agent tools -----------------------------------------------------------
  const columnHelp = COLUMNS.map((column) => `"${column.id}"`).join(", ");

  bb.agents.registerTool({
    name: "kanban_move",
    description: `Move a thread's card on the Kanban board. Columns: ${columnHelp}. Defaults to the current thread. Adds the thread to the board if it is not on it yet.`,
    instructions: [
      "Kanban board: your thread is a card on a board the user watches.",
      "Call kanban_move when the state of your work changes — column \"in-progress\" when you start,",
      "\"review\" when there is output for the user to check, \"done\" when the request is complete.",
      "Pass a short note (what changed, what is blocking) so the card explains itself.",
      "Use kanban_board to see every card, e.g. when coordinating child threads.",
    ].join(" "),
    presentation: {
      label: { pending: "Moving Kanban card", completed: "Moved Kanban card" },
    },
    parameters: z.object({
      column: z
        .string()
        .min(1)
        .describe(`Target column: ${columnHelp} (aliases such as "doing", "wip", "complete" work).`),
      threadId: z
        .string()
        .min(1)
        .optional()
        .describe("Thread to move. Omit for the current thread."),
      note: noteSchema
        .optional()
        .describe("Short status note shown on the card (max 500 chars)."),
    }),
    async execute({ column, threadId, note }, ctx) {
      const columnId = normaliseColumn(column);
      if (columnId === null) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown column "${column}". Use one of ${columnHelp}.` }],
        };
      }
      const target = threadId ?? ctx.threadId;
      const existing = store.get(target);
      if (existing === null) {
        const projectId = await resolveProjectId(target, target === ctx.threadId ? ctx.projectId : undefined);
        await addCard(target, projectId, columnId, "agent");
        if (note !== undefined && note !== "") await moveCard(target, columnId, "agent", { note });
        return `Added ${target} to the board in ${columnName(columnId)}.`;
      }
      const result = await moveCard(target, columnId, "agent", note === undefined ? {} : { note });
      if (result === null || !result.changed) {
        return `${target} is already in ${columnName(columnId)}.`;
      }
      return `Moved ${target} from ${columnName(existing.columnId)} to ${columnName(columnId)}.`;
    },
  });

  bb.agents.registerTool({
    name: "kanban_board",
    description: "Read the Kanban board: every thread card grouped by column, with notes.",
    presentation: {
      label: { pending: "Reading Kanban board", completed: "Read Kanban board" },
    },
    parameters: z.object({
      projectId: z.string().min(1).optional().describe("Limit to one project. Omit for the current project; pass \"all\" for every project."),
    }),
    execute({ projectId }, ctx) {
      const scope = projectId === "all" ? null : (projectId ?? ctx.projectId);
      return renderBoard(store.list(scope), ctx.threadId);
    },
  });

  bb.agents.contributeInstructions(({ threadId }) => {
    const card = store.get(threadId);
    if (card === null) return null;
    return `Kanban: this thread's card is in "${columnName(card.columnId)}"${card.note === "" ? "" : ` (note: ${JSON.stringify(card.note)})`}. Move it with the kanban_move tool or \`bb kanban move <column>\` as your work progresses.`;
  });

  // ---- CLI (any provider, any shell) ------------------------------------------
  const jsonOption = { type: "boolean", description: "Emit machine-readable JSON" } as const;
  const threadOption = {
    type: "string",
    description: "Thread id (defaults to the current thread when run from one)",
    aliases: ["thread-id", "id"],
  } as const;

  function requireThread(value: string | undefined, ctxThreadId: string | undefined): string {
    const threadId = value ?? ctxThreadId;
    if (threadId === undefined || threadId === "") {
      throw new PluginCliError("no thread given", {
        code: "thread_required",
        hint: "Pass --thread <thr_id>.",
      });
    }
    return threadId;
  }

  bb.cli.register(
    defineCli({
      name: "kanban",
      summary: "Move thread cards on the Kanban board",
      description: `Columns: ${columnHelp}.`,
      commands: {
        board: cliCommand({
          summary: "Show the board",
          options: {
            project: { type: "string", description: "Project id, or \"all\" (default: current project, else all)" },
            json: jsonOption,
          },
          run(input, ctx) {
            const scope =
              input.options.project === "all"
                ? null
                : (input.options.project ?? ctx.projectId ?? null);
            const cards = store.list(scope);
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ columns: COLUMNS, cards })
                : renderBoard(cards, ctx.threadId),
            };
          },
        }),
        move: cliCommand({
          summary: "Move a card to a column (adds the thread if needed)",
          positionals: [{ name: "column", description: `One of ${columnHelp}`, required: true }],
          options: {
            thread: threadOption,
            note: { type: "string", description: "Status note shown on the card (max 500 chars)" },
            json: jsonOption,
          },
          async run(input, ctx) {
            const columnId = normaliseColumn(input.positionals.column);
            if (columnId === null) {
              throw new PluginCliError(`unknown column "${input.positionals.column}"`, {
                code: "unknown_column",
                hint: `Use one of ${columnHelp}.`,
              });
            }
            const threadId = requireThread(input.options.thread, ctx.threadId);
            const note = input.options.note?.slice(0, 500);
            const existing = store.get(threadId);
            if (existing === null) {
              const projectId = await resolveProjectId(threadId, threadId === ctx.threadId ? ctx.projectId : undefined);
              const added = await addCard(threadId, projectId, columnId, "agent");
              const card = note === undefined ? added.card : (await moveCard(threadId, columnId, "agent", { note }))?.card ?? added.card;
              return {
                exitCode: 0,
                stdout: input.options.json ? JSON.stringify(card) : `Added ${threadId} to ${columnName(columnId)}.`,
              };
            }
            const result = await moveCard(threadId, columnId, "agent", note === undefined ? {} : { note });
            const card = result?.card ?? existing;
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(card)
                : result?.changed
                  ? `Moved ${threadId} to ${columnName(columnId)}.`
                  : `${threadId} is already in ${columnName(columnId)}.`,
            };
          },
        }),
        add: cliCommand({
          summary: "Add a thread to the board",
          positionals: [{ name: "thread", description: "Thread id", required: true }],
          options: {
            column: { type: "string", description: "Starting column (default backlog)" },
            json: jsonOption,
          },
          async run(input) {
            const columnId = input.options.column === undefined ? "backlog" : normaliseColumn(input.options.column);
            if (columnId === null) {
              throw new PluginCliError(`unknown column "${input.options.column}"`, {
                code: "unknown_column",
                hint: `Use one of ${columnHelp}.`,
              });
            }
            const threadId = input.positionals.thread;
            const projectId = await resolveProjectId(threadId);
            const result = await addCard(threadId, projectId, columnId, "agent");
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : result.created
                  ? `Added ${threadId} to ${columnName(columnId)}.`
                  : `${threadId} is already on the board in ${columnName(result.card.columnId)}.`,
            };
          },
        }),
        remove: cliCommand({
          summary: "Remove a thread's card from the board",
          positionals: [{ name: "thread", description: "Thread id", required: true }],
          options: { json: jsonOption },
          async run(input) {
            const threadId = input.positionals.thread;
            const removed = await removeCard(threadId);
            if (!removed) {
              throw new PluginCliError(`${threadId} is not on the board`, {
                code: "card_not_found",
                hint: "Run `bb kanban board` to list cards.",
              });
            }
            return {
              exitCode: 0,
              stdout: input.options.json ? JSON.stringify({ removed: true, threadId }) : `Removed ${threadId}.`,
            };
          },
        }),
        history: cliCommand({
          summary: "Show a card's column history",
          options: { thread: threadOption, json: jsonOption },
          run(input, ctx) {
            const threadId = requireThread(input.options.thread, ctx.threadId);
            const moves = store.history(threadId);
            if (input.options.json) return { exitCode: 0, stdout: JSON.stringify({ moves }) };
            if (moves.length === 0) return { exitCode: 0, stdout: `${threadId} has no moves.` };
            const lines = moves.map(
              (move) =>
                `${new Date(move.at).toISOString()}  ${move.fromColumn === null ? "(added)" : columnName(move.fromColumn)} -> ${columnName(move.toColumn)}  by ${move.movedBy}${move.note === "" ? "" : `  "${move.note}"`}`,
            );
            return { exitCode: 0, stdout: lines.join("\n") };
          },
        }),
      },
    }),
  );

  // ---- Thread lifecycle keeps the board honest --------------------------------
  bb.events.on("thread.created", async ({ thread }) => {
    const { autoAdd } = await settings.get();
    if (!autoAdd || thread.visibility === "hidden") return;
    await addCard(thread.id, thread.projectId, "backlog", "system");
  });

  bb.events.on("thread.active", async ({ thread }) => {
    const { autoStart } = await settings.get();
    if (!autoStart) return;
    const card = store.get(thread.id);
    if (card === null || card.columnId !== "backlog") return;
    await moveCard(thread.id, "in-progress", "system");
  });

  bb.events.on("thread.archived", async ({ thread }) => {
    const { autoDoneOnArchive } = await settings.get();
    if (autoDoneOnArchive) {
      await moveCard(thread.id, "done", "system");
      return;
    }
    await removeCard(thread.id);
  });

  bb.events.on("thread.deleted", async ({ thread }) => {
    await removeCard(thread.id);
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}

/** Bounded text rendering shared by the tool and the CLI. */
function renderBoard(cards: Card[], currentThreadId?: string): string {
  if (cards.length === 0) return "The board is empty.";
  const limit = 200;
  const shown = cards.slice(0, limit);
  const lines: string[] = [];
  for (const column of COLUMNS) {
    const inColumn = shown.filter((card) => card.columnId === column.id);
    lines.push(`## ${column.name} (${inColumn.length})`);
    for (const card of inColumn) {
      const marker = card.threadId === currentThreadId ? " (this thread)" : "";
      const note = card.note === "" ? "" : ` — ${card.note}`;
      lines.push(`- ${card.threadId}${marker} [${card.movedBy}]${note}`);
    }
  }
  if (cards.length > limit) lines.push(`… ${cards.length - limit} more cards not shown.`);
  return lines.join("\n");
}
