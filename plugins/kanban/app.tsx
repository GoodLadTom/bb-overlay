// bb-plugin-kanban — frontend entry.
//
// The Kanban page: four columns of thread cards. Cards drag between (and
// within) columns; every write goes through RPC and the server's
// "board-changed" signal refetches the board in every open window.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import {
  definePluginApp,
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbContext,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Card, ColumnId, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Column = { id: ColumnId; name: string };

const ALL_PROJECTS = "__all__";

function useBoard(projectId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    toast.error(message);
  }, []);
  const refetch = useCallback(() => {
    rpc.call("board_get", { projectId }).then((result) => {
      setColumns(result.columns);
      setCards(result.cards);
      setError(null);
    }, report);
  }, [rpc, projectId, report]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("board-changed", refetch);
  // Signals are not replayed across a reconnect: reconcile when the socket returns.
  const connection = useRealtimeConnectionState();
  const seenConnected = useRef(false);
  useEffect(() => {
    if (connection !== "connected") return;
    if (seenConnected.current) refetch();
    seenConnected.current = true;
  }, [connection, refetch]);
  return { rpc, columns, cards, setCards, error, report, refetch };
}

function threadLabel(thread: PluginSidebarThread | undefined, threadId: string): string {
  return thread?.title ?? thread?.titleFallback ?? threadId;
}

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A small status glyph derived from the host's resolved sidebar indicator. */
function StatusDot({ thread }: { thread: PluginSidebarThread | undefined }) {
  if (thread === undefined) {
    return (
      <span
        className="size-2 shrink-0 rounded-full border border-muted-foreground/60"
        aria-label="Thread not in sidebar (archived or deleted)"
        role="img"
      />
    );
  }
  const indicator = thread.indicator;
  const className =
    indicator === "runtime" ||
    indicator === "background-agent" ||
    indicator === "background-command" ||
    indicator === "workflow" ||
    indicator === "goal" ||
    indicator === "plan-mode"
      ? "bg-primary animate-pulse"
      : indicator === "waiting-for-input" || thread.hasPendingInteraction
        ? "bg-destructive"
        : indicator === "unread-error"
          ? "bg-destructive/60"
          : indicator === "unread-success"
            ? "bg-primary/60"
            : "bg-muted-foreground/40";
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", className)}
      role="img"
      aria-label={thread.indicatorLabel ?? "Idle"}
      title={thread.indicatorLabel ?? "Idle"}
    />
  );
}

interface CardViewProps {
  card: Card;
  thread: PluginSidebarThread | undefined;
  columns: Column[];
  providerName: string | null;
  projectName: string | null;
  onOpen: () => void;
  onMove: (columnId: ColumnId) => void;
  onRemove: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDropBefore: (event: DragEvent<HTMLElement>) => void;
  dragging: boolean;
}

function CardView({
  card,
  thread,
  columns,
  providerName,
  projectName,
  onOpen,
  onMove,
  onRemove,
  onDragStart,
  onDropBefore,
  dragging,
}: CardViewProps) {
  const [over, setOver] = useState(false);
  const label = threadLabel(thread, card.threadId);
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        onDropBefore(event);
      }}
      data-thread-id={card.threadId}
      className={cn(
        "group rounded-md border border-border bg-card p-2.5 text-sm shadow-xs transition-colors",
        dragging && "opacity-40",
        over && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex items-start gap-2">
        <StatusDot thread={thread} />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 cursor-pointer text-left font-medium leading-snug text-foreground hover:underline"
          title={`Open ${label}`}
        >
          <span className="line-clamp-2">{label}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Remove "${label}" from the board`}
          onClick={onRemove}
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>
      {card.note === "" ? null : (
        <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{card.note}</p>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {[projectName, providerName].filter((part) => part !== null).join(" · ")}
        </span>
        <span className="ml-auto shrink-0" title={new Date(card.updatedAt).toLocaleString()}>
          {card.movedBy} · {relativeTime(card.updatedAt)}
        </span>
      </div>
      <label className="mt-1.5 block">
        <span className="sr-only">Move "{label}" to column</span>
        <select
          value={card.columnId}
          onChange={(event) => onMove(event.target.value as ColumnId)}
          className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function BoardPage() {
  const { projectId: routeProjectId } = useBbContext();
  const [projectFilter, setProjectFilter] = useState<string>(routeProjectId ?? ALL_PROJECTS);
  const scope = projectFilter === ALL_PROJECTS ? null : projectFilter;
  const { rpc, columns, cards, setCards, error, report, refetch } = useBoard(scope);
  const sidebar = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const { providers } = experimental_useProviders();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<ColumnId | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);

  const threadsById = useMemo(() => {
    const map = new Map<string, PluginSidebarThread>();
    for (const thread of sidebar.threads) map.set(thread.id, thread);
    return map;
  }, [sidebar.threads]);
  const projectsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of sidebar.projects) map.set(project.id, project.name);
    return map;
  }, [sidebar.projects]);
  const providerName = useCallback(
    (thread: PluginSidebarThread | undefined) => {
      if (thread === undefined) return null;
      return providers.find((provider) => provider.id === thread.providerId)?.displayName ?? thread.providerId;
    },
    [providers],
  );

  const onBoard = useMemo(() => new Set((cards ?? []).map((card) => card.threadId)), [cards]);
  const unboarded = useMemo(
    () =>
      sidebar.threads.filter(
        (thread) =>
          !thread.isArchived &&
          !onBoard.has(thread.id) &&
          (scope === null || thread.projectId === scope),
      ),
    [sidebar.threads, onBoard, scope],
  );

  const move = useCallback(
    (threadId: string, columnId: ColumnId, place: { beforeThreadId?: string | null } = {}) => {
      // Optimistic column change; the realtime signal reconciles positions.
      setCards((current) =>
        current === null
          ? current
          : current.map((card) => (card.threadId === threadId ? { ...card, columnId, movedBy: "user" } : card)),
      );
      rpc.call("card_move", { threadId, columnId, ...place }).then(refetch, (cause) => {
        report(cause);
        refetch();
      });
    },
    [rpc, setCards, refetch, report],
  );
  const remove = useCallback(
    (threadId: string) => {
      rpc.call("card_remove", { threadId }).then(refetch, report);
    },
    [rpc, refetch, report],
  );
  const add = useCallback(
    (thread: PluginSidebarThread) => {
      rpc.call("card_add", { threadId: thread.id, projectId: thread.projectId }).then(refetch, report);
    },
    [rpc, refetch, report],
  );

  const readDragged = (event: DragEvent<HTMLElement>): string | null => {
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    return id === null || id === "" ? null : id;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Project
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {sidebar.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">
          {cards === null ? "" : `${cards.length} card${cards.length === 1 ? "" : "s"}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-xs"
          onClick={() => setTrayOpen((open) => !open)}
          aria-expanded={trayOpen}
        >
          <Icon name="Plus" className="size-3.5" />
          Not on board ({unboarded.length})
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="px-4 pt-2 text-sm text-destructive md:px-5">
          {error}
        </p>
      )}
      {trayOpen ? (
        <div className="border-b border-border px-4 py-2 md:px-5">
          {unboarded.length === 0 ? (
            <p className="text-xs text-muted-foreground">Every thread in view is on the board.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {unboarded.slice(0, 50).map((thread) => (
                <li key={thread.id}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 max-w-64 text-xs"
                    onClick={() => add(thread)}
                    aria-label={`Add "${threadLabel(thread, thread.id)}" to Backlog`}
                  >
                    <Icon name="Plus" className="size-3" />
                    <span className="truncate">{threadLabel(thread, thread.id)}</span>
                  </Button>
                </li>
              ))}
              {unboarded.length > 50 ? (
                <li className="self-center text-xs text-muted-foreground">+{unboarded.length - 50} more</li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        {columns === null || cards === null ? (
          <div className="p-4 md:p-5">
            <EmptyState>Loading board…</EmptyState>
          </div>
        ) : (
          <div className="flex h-full min-w-max gap-3 p-4 md:p-5">
            {columns.map((column) => {
              const inColumn = cards.filter((card) => card.columnId === column.id);
              return (
                <section
                  key={column.id}
                  aria-label={column.name}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOverColumn(column.id);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverColumn(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setOverColumn(null);
                    const threadId = readDragged(event);
                    setDraggingId(null);
                    if (threadId !== null) move(threadId, column.id);
                  }}
                  className={cn(
                    "flex h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30 transition-colors",
                    overColumn === column.id && "border-primary/60 bg-primary/5",
                  )}
                >
                  <header className="flex items-center gap-2 px-3 py-2">
                    <h2 className="text-sm font-semibold text-foreground">{column.name}</h2>
                    <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                      {inColumn.length}
                    </span>
                  </header>
                  <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                    {inColumn.length === 0 ? (
                      <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                        Drop a card here
                      </li>
                    ) : null}
                    {inColumn.map((card) => {
                      const thread = threadsById.get(card.threadId);
                      return (
                        <CardView
                          key={card.threadId}
                          card={card}
                          thread={thread}
                          columns={columns}
                          providerName={providerName(thread)}
                          projectName={scope === null ? (projectsById.get(card.projectId) ?? null) : null}
                          dragging={draggingId === card.threadId}
                          onOpen={() => actions.open(card.threadId)}
                          onMove={(columnId) => move(card.threadId, columnId)}
                          onRemove={() => remove(card.threadId)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", card.threadId);
                            event.dataTransfer.effectAllowed = "move";
                            setDraggingId(card.threadId);
                          }}
                          onDropBefore={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setOverColumn(null);
                            const threadId = readDragged(event);
                            setDraggingId(null);
                            if (threadId === null || threadId === card.threadId) return;
                            move(threadId, column.id, { beforeThreadId: card.threadId });
                          }}
                        />
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CardCount() {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState<number | null>(null);
  const refetch = useCallback(() => {
    rpc.call("board_get", { projectId: null }).then(
      (result) => setCount(result.cards.filter((card) => card.columnId !== "done").length),
      () => setCount(null),
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("board-changed", refetch);
  return count === null || count === 0 ? null : (
    <span className="text-xs text-muted-foreground">{count}</span>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "board",
    title: "Kanban",
    icon: "Columns2",
    path: "board",
    component: BoardPage,
    experimental_sidebarAccessory: CardCount,
  });
});
