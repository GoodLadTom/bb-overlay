// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "./server";

const now = Date.now();
const card = (threadId: string, columnId: "backlog" | "in-progress" | "review" | "done", note = "") => ({
  threadId,
  projectId: "proj_1",
  columnId,
  position: 1,
  note,
  movedBy: "agent" as const,
  createdAt: now,
  updatedAt: now,
});
const thread = (id: string, title: string) => ({
  id,
  projectId: "proj_1",
  title,
  titleFallback: null,
  parentThreadId: null,
  sectionId: null,
  originKind: null,
  originPluginId: null,
  providerId: "claude-code",
  hasPendingInteraction: false,
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
  indicator: "none" as const,
  indicatorLabel: null,
  isUnread: false,
  isPinned: false,
  isArchived: false,
  environment: null,
  host: null,
  createdAt: now,
  updatedAt: now,
  lastReadAt: null,
  latestAttentionAt: now,
});

describe("Kanban page", () => {
  it("renders cards by column, opens a thread, and moves a card", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.navPanels[0]?.path).toBe("board");
    const moves: unknown[] = [];
    const slot = renderSlot<{ subPath: string }, typeof rpcContract>(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          board_get: () => ({
            columns: [
              { id: "backlog", name: "Backlog" },
              { id: "in-progress", name: "In progress" },
              { id: "review", name: "Review" },
              { id: "done", name: "Done" },
            ],
            cards: [card("thr_a", "in-progress", "wiring the API"), card("thr_b", "review")],
          }),
          card_move: (input) => {
            moves.push(input);
            return { card: { ...card(input.threadId, input.columnId) }, changed: true };
          },
          card_add: (input) => ({ card: card(input.threadId, "backlog"), created: true }),
          card_remove: () => ({ removed: true }),
          card_history: () => ({ moves: [] }),
        },
        sidebarThreads: {
          status: "ready",
          threads: [thread("thr_a", "Build the API"), thread("thr_b", "Write docs"), thread("thr_c", "Unboarded")],
          projects: [{ id: "proj_1", name: "Personal", isPersonal: true }],
        },
      },
    );
    await slot.findByText("Build the API");
    await slot.findByText("wiring the API");
    expect(slot.getByText("Not on board (1)")).toBeTruthy();

    fireEvent.click(slot.getByText("Build the API"));
    expect(slot.inspection.sidebarActionCalls).toContainEqual(
      expect.objectContaining({ method: "open", threadId: "thr_a" }),
    );

    const select = slot.getByLabelText('Move "Build the API" to column') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "done" } });
    await slot.findByText("2 cards");
    expect(moves).toContainEqual({ threadId: "thr_a", columnId: "done" });
    slot.lifecycle.unmount();
  });
});
