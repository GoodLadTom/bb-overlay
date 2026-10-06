import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { BoardStore, MIGRATIONS, normaliseColumn } from "./board";

describe("normaliseColumn", () => {
  it("maps ids, names and aliases", () => {
    expect(normaliseColumn("in-progress")).toBe("in-progress");
    expect(normaliseColumn("In Progress")).toBe("in-progress");
    expect(normaliseColumn("doing")).toBe("in-progress");
    expect(normaliseColumn("WIP")).toBe("in-progress");
    expect(normaliseColumn("complete")).toBe("done");
    expect(normaliseColumn("todo")).toBe("backlog");
    expect(normaliseColumn("nope")).toBeNull();
    expect(normaliseColumn("")).toBeNull();
  });
});

describe("BoardStore", () => {
  let store: BoardStore;
  beforeEach(() => {
    const db = new Database(":memory:");
    for (const statement of MIGRATIONS) db.exec(statement);
    let tick = 1000;
    store = new BoardStore(db, () => (tick += 1));
  });

  it("adds once and records the move", () => {
    expect(store.add("t1", "p1").created).toBe(true);
    expect(store.add("t1", "p1").created).toBe(false);
    expect(store.list()).toHaveLength(1);
    expect(store.history("t1")).toMatchObject([{ fromColumn: null, toColumn: "backlog" }]);
  });

  it("moves between columns and appends to the end", () => {
    store.add("t1", "p1");
    store.add("t2", "p1");
    const result = store.move("t2", "in-progress", "agent", { note: "started" });
    expect(result).toMatchObject({ changed: true, card: { columnId: "in-progress", note: "started" } });
    expect(store.move("t2", "in-progress", "agent")).toMatchObject({ changed: false });
    expect(store.history("t2").map((move) => move.toColumn)).toEqual(["in-progress", "backlog"]);
  });

  it("places a card before a sibling", () => {
    store.add("a", "p1");
    store.add("b", "p1");
    store.add("c", "p1");
    store.move("c", "backlog", "user", { beforeThreadId: "a" });
    expect(store.list().map((card) => card.threadId)).toEqual(["c", "a", "b"]);
    store.move("a", "backlog", "user", { afterThreadId: "b" });
    expect(store.list().map((card) => card.threadId)).toEqual(["c", "b", "a"]);
  });

  it("filters by project and removes", () => {
    store.add("a", "p1");
    store.add("b", "p2");
    expect(store.list("p2").map((card) => card.threadId)).toEqual(["b"]);
    expect(store.remove("a")).toBe(true);
    expect(store.remove("a")).toBe(false);
    expect(store.history("a")).toEqual([]);
  });

  it("returns null when moving an unknown card", () => {
    expect(store.move("ghost", "done", "agent")).toBeNull();
  });
});

describe("plugin", () => {
  const metadataCalls: unknown[] = [];
  let host: ReturnType<typeof createFakePluginHost>;

  beforeEach(async () => {
    metadataCalls.length = 0;
    host = createFakePluginHost({
      pluginId: "kanban",
      sdk: {
        threads: {
          get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, projectId: "proj_x" }),
          updatePluginMetadata: async (args: unknown) => {
            metadataCalls.push(args);
            return {};
          },
        },
      },
    });
    await plugin(host.bb);
  });
  afterEach(async () => {
    await host.harness.lifecycle.dispose();
  });

  it("registers the tools, CLI and rpc", () => {
    const registrations = host.harness.registrations;
    expect(registrations.agentTools.map((tool) => tool.name).sort()).toEqual(["kanban_board", "kanban_move"]);
    expect(registrations.rpcMethods.sort()).toEqual([
      "board_get",
      "card_add",
      "card_history",
      "card_move",
      "card_remove",
    ]);
    expect(registrations.cli?.name).toBe("kanban");
  });

  it("auto-adds a created thread and advances it when it runs", async () => {
    const thread = makeThreadResponse({ id: "thr_1", projectId: "proj_x", visibility: "visible" });
    await host.harness.behavior.emitThreadEvent("thread.created", { thread });
    let board = await host.harness.behavior.callRpc("board_get", { projectId: null });
    expect(board.cards).toMatchObject([{ threadId: "thr_1", columnId: "backlog", movedBy: "system" }]);

    await host.harness.behavior.emitThreadEvent("thread.active", { thread });
    board = await host.harness.behavior.callRpc("board_get", { projectId: "proj_x" });
    expect(board.cards).toMatchObject([{ threadId: "thr_1", columnId: "in-progress" }]);
    expect(host.harness.realtimeSignals.filter((signal) => signal.channel === "board-changed")).toHaveLength(2);
    expect(metadataCalls).toContainEqual({ pluginId: "kanban", threadId: "thr_1", set: { column: "in-progress" } });
  });

  it("ignores hidden threads and drops archived ones", async () => {
    const hidden = makeThreadResponse({ id: "thr_h", visibility: "hidden" });
    await host.harness.behavior.emitThreadEvent("thread.created", { thread: hidden });
    const visible = makeThreadResponse({ id: "thr_v", visibility: "visible" });
    await host.harness.behavior.emitThreadEvent("thread.created", { thread: visible });
    await host.harness.behavior.emitThreadEvent("thread.archived", { thread: visible });
    const board = await host.harness.behavior.callRpc("board_get", { projectId: null });
    expect(board.cards).toEqual([]);
  });

  it("moves to Done on archive when configured", async () => {
    await host.harness.behavior.setSettings({ autoDoneOnArchive: true });
    const thread = makeThreadResponse({ id: "thr_a", visibility: "visible" });
    await host.harness.behavior.emitThreadEvent("thread.created", { thread });
    await host.harness.behavior.emitThreadEvent("thread.archived", { thread });
    const board = await host.harness.behavior.callRpc("board_get", { projectId: null });
    expect(board.cards).toMatchObject([{ threadId: "thr_a", columnId: "done" }]);
  });

  it("lets an agent move its own thread and add another", async () => {
    const own = await host.harness.behavior.callAgentTool("kanban_move", { column: "review", note: "ready" });
    expect(String(own)).toContain("Added");
    const other = await host.harness.behavior.callAgentTool("kanban_move", {
      column: "doing",
      threadId: "thr_child",
    });
    expect(String(other)).toContain("thr_child");
    const bad = await host.harness.behavior.callAgentTool("kanban_move", { column: "limbo" });
    expect(bad).toMatchObject({ isError: true });
    const board = await host.harness.behavior.callAgentTool("kanban_board", { projectId: "all" });
    expect(String(board)).toContain("## Review (1)");
    expect(String(board)).toContain("ready");
  });

  it("drives the CLI", async () => {
    const add = await host.harness.behavior.runCli(["add", "thr_cli"]);
    expect(add.exitCode).toBe(0);
    const move = await host.harness.behavior.runCli(["move", "done", "--thread", "thr_cli", "--note", "shipped", "--json"]);
    expect(move.exitCode).toBe(0);
    expect(JSON.parse(move.stdout ?? "")).toMatchObject({ columnId: "done", note: "shipped" });
    const history = await host.harness.behavior.runCli(["history", "--thread", "thr_cli"]);
    expect(history.stdout).toContain("Backlog -> Done");
    const unknown = await host.harness.behavior.runCli(["move", "limbo", "--thread", "thr_cli"]);
    expect(unknown.exitCode).not.toBe(0);
    const noThread = await host.harness.behavior.runCli(["move", "done"]);
    expect(noThread.exitCode).not.toBe(0);
    expect(noThread.stderr).toContain("--thread");
    const removed = await host.harness.behavior.runCli(["remove", "thr_cli"]);
    expect(removed.exitCode).toBe(0);
    const board = await host.harness.behavior.runCli(["board", "--project", "all"]);
    expect(board.stdout).toBe("The board is empty.");
  });

  it("rejects bad rpc input and reorders on drag", async () => {
    await host.harness.behavior.callRpc("card_add", { threadId: "a", projectId: "p" });
    await host.harness.behavior.callRpc("card_add", { threadId: "b", projectId: "p" });
    await host.harness.behavior.callRpc("card_move", { threadId: "b", columnId: "backlog", beforeThreadId: "a" });
    const board = await host.harness.behavior.callRpc("board_get", { projectId: "p" });
    expect(board.cards.map((card) => card.threadId)).toEqual(["b", "a"]);
    await expect(
      host.harness.behavior.callRpc("card_move", { threadId: "a", columnId: "limbo" as never }),
    ).rejects.toThrow();
    await expect(host.harness.behavior.callRpc("card_move", { threadId: "ghost", columnId: "done" })).rejects.toThrow(
      /not on the board/,
    );
  });
});
