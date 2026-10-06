// The rail: bb's sidebar thread list, run-sheet style.
//   NOW card -> harness filter -> Needs you -> Pinned -> one section per
//   project, each a tree of real folders (from project-folders) with chats
//   inside, every row marked with its harness.
// Every row has a right-click menu wired to bb's own thread actions; folders
// have their own. Chats drag onto folders; folders drag onto folders.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import {
  experimental_Icon as Icon,
  experimental_useSidebarThreadActions as useThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { LogoOrb } from "./orb";
import { useVoiceState } from "./voice";
import { cn } from "@/lib/utils";
import { GOLD, GOLD_INK, Lattice, Node, ago, byUrgencyThenRecent, caps, harnessOf, stateOf, tnum, type Harness } from "./shared";
import { folderOfThread, goTo, newChatInFolderUrl, slug, useFolders, type Directory, type Folder, type FolderData } from "./folders";
import { Menu, MenuItem, MenuLabel, MenuSeparator, MenuSub } from "./menu";
import { TAG_CSS, useRailState, type LaterReason, type RailOps, type Tag } from "./rail-state";
import { LATER_LABEL, StatusMark } from "./status-mark";
import { TagFilter, TagSwatches } from "./tags";
import { BulkBar } from "./bulk-bar";
import { TodoBadge, useFolderTodoCounts } from "./todo";
import { CloudGlyph, MachineMark, useMachine, useMachineActions, type MachineItem } from "./machine";

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
const FOLD = 8;
const NEEDS_FOLD = 4;
const DRAG_THREAD = "application/x-nav-thread";
const DRAG_FOLDER = "application/x-nav-folder";

/* ----------------------------- persistence ----------------------------- */

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: state stays in memory */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

const report = (verb: string) => (e: unknown) => toast.error(`${verb} failed`, { description: e instanceof Error ? e.message : String(e) });

/* ------------------------------ inline edit ---------------------------- */

function InlineInput({ initial, placeholder, depth, onSubmit, onCancel }: {
  initial: string;
  placeholder: string;
  depth: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const v = e.currentTarget.value.trim();
      if (v) onSubmit(v);
      else onCancel();
    } else if (e.key === "Escape") onCancel();
  };
  return (
    <div className="flex h-[34px] items-center pr-2" style={{ paddingLeft: 10 + depth * 16 }}>
      <input
        ref={ref}
        defaultValue={initial}
        placeholder={placeholder}
        onKeyDown={onKey}
        onBlur={onCancel}
        className="h-7 w-full rounded-md border border-[var(--attention)] bg-background px-2 text-[13px] text-foreground outline-none"
      />
    </div>
  );
}

/* -------------------------------- rows --------------------------------- */

type FolderOption = { id: string | null; label: string; depth: number; group?: boolean };

type RowCtx = {
  ops: RailOps;
  /** Chats handed over to the always-on machine, keyed by this laptop's thread id. */
  machine: Record<string, MachineItem>;
  /** An always-on machine is set up, so the hand-off menu items show. */
  hasMachine: boolean;
  selecting: boolean;
  selected: ReadonlySet<string>;
  /** Handles ⌘/⇧-click and Select mode; returns true when the click was a selection. */
  onSelectGesture: (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => boolean;
  onNewTag: (threadIds: string[]) => void;
};

function ThreadRow({ thread, active, depth, now, onNavigate, moveTargets, onMove, ctx }: {
  thread: PluginSidebarThread;
  active: boolean;
  depth: number;
  now: number;
  onNavigate: () => void;
  moveTargets: FolderOption[] | null;
  onMove: (folderId: string | null) => void;
  ctx: RowCtx;
}) {
  const actions = useThreadActions();
  const machineActions = useMachineActions();
  const onMachine = ctx.machine[thread.id];
  const [renaming, setRenaming] = useState(false);
  const state = stateOf(thread);
  const h = harnessOf(thread.providerId);
  const later = (ctx.ops.state.later[thread.id]?.reason ?? null) as LaterReason | null;
  const tagIds = ctx.ops.state.assign[thread.id] ?? [];
  const tags = ctx.ops.state.tags.filter((t) => tagIds.includes(t.id));
  const isSelected = ctx.selected.has(thread.id);
  // Menu actions apply to the whole selection when this row is part of it.
  const targets = isSelected && ctx.selected.size > 1 ? [...ctx.selected] : [thread.id];

  if (renaming) {
    return (
      <InlineInput
        initial={thread.displayTitle}
        placeholder="Thread title"
        depth={depth}
        onCancel={() => setRenaming(false)}
        onSubmit={(v) => {
          setRenaming(false);
          actions.rename(thread.id, v).catch(report("Rename"));
        }}
      />
    );
  }

  const onDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.setData(DRAG_THREAD, JSON.stringify({ id: thread.id, projectId: thread.projectId }));
    e.dataTransfer.effectAllowed = "move";
  };

  const anchor = (
    <a
      href={thread.href}
      onClick={(e) => {
        if (ctx.onSelectGesture(thread.id, e)) {
          e.preventDefault();
          return;
        }
        onNavigate();
      }}
      aria-selected={ctx.selecting || ctx.selected.size > 0 ? isSelected : undefined}
      draggable
      onDragStart={onDragStart}
      data-sidebar-thread-shortcut-target=""
      data-sidebar-thread-id={thread.id}
      aria-current={active ? "page" : undefined}
      aria-label={`${thread.displayTitle}, ${h.label}${thread.indicatorLabel ? `, ${thread.indicatorLabel}` : ""}`}
      title={thread.displayTitle}
      className={cn(
        "group relative flex h-[34px] items-center gap-2.5 rounded-md pr-2 text-[13.5px] no-underline outline-none transition-colors",
        "hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent",
        active ? "bg-accent font-semibold text-foreground" : state === "parked" && !later ? "text-muted-foreground" : "text-foreground",
        isSelected && "bg-[var(--surface-selected)] ring-1 ring-inset ring-[var(--surface-selected-border)]",
      )}
      style={{ paddingLeft: 10 + depth * 16 }}
    >
      {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-[2px]" style={{ background: GOLD }} /> : null}
      {ctx.selecting ? (
        <span aria-hidden className={cn("inline-flex size-[13px] shrink-0 items-center justify-center rounded-[3px] border", isSelected ? "border-foreground bg-foreground text-background" : "border-input bg-background")}>
          {isSelected ? <Icon name="Check" className="size-2.5" /> : null}
        </span>
      ) : later && state !== "running" ? (
        <span className="inline-flex w-[11px] shrink-0 items-center justify-center"><StatusMark reason={later} size={13} /></span>
      ) : (
        <Node state={state} />
      )}
      <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
      {onMachine ? <MachineMark item={onMachine} threadId={thread.id} /> : null}
      <TagSwatches tags={tags} />
      {thread.isPinned ? <Icon name="Pin" className="size-3 shrink-0 opacity-50" /> : null}
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">{h.label}</span>
      <span className="w-6 shrink-0 text-right text-[11px] text-muted-foreground" style={tnum}>
        {ago(thread.updatedAt, now)}
      </span>
    </a>
  );

  return (
    <Menu trigger={anchor}>
      <MenuItem icon="ArrowUpRight" label="Open" onSelect={() => { actions.open(thread.id); onNavigate(); }} />
      <MenuItem icon="Columns2" label="Open in split" onSelect={() => { actions.open(thread.id, { split: true }); onNavigate(); }} />
      <MenuSeparator />
      <MenuItem icon={thread.isPinned ? "Pin" : "Pin"} label={thread.isPinned ? "Unpin" : "Pin"} onSelect={() => actions.setPinned(thread.id, !thread.isPinned).catch(report("Pin"))} />
      <MenuItem
        icon={thread.isUnread ? "Mail" : "Mail"}
        label={thread.isUnread ? "Mark as read" : "Mark as unread"}
        onSelect={() => actions.setRead(thread.id, thread.isUnread).catch(report("Update"))}
      />
      <MenuItem icon="Edit" label="Rename" onSelect={() => setRenaming(true)} />
      <MenuSeparator />
      <MenuSub icon="Clock" label={targets.length > 1 ? `Come back later (${targets.length})` : "Come back later"}>
        {(["revisit", "done", "mistake"] as const).map((r) => (
          <MenuItem key={r} lead={<StatusMark reason={r} size={13} />} label={LATER_LABEL[r]} checked={later === r && targets.length === 1} onSelect={() => void ctx.ops.setLater(targets, r)} />
        ))}
        {later ? <MenuSeparator /> : null}
        {later ? <MenuItem icon="X" label="Clear the flag" onSelect={() => void ctx.ops.setLater(targets, null)} /> : null}
      </MenuSub>
      <MenuSub icon="ListTodo" label={targets.length > 1 ? `Tags (${targets.length})` : "Tags"}>
        {ctx.ops.state.tags.map((t) => {
          const on = targets.every((id) => (ctx.ops.state.assign[id] ?? []).includes(t.id));
          return <MenuItem key={t.id} swatch={TAG_CSS[t.color]} label={t.name} checked={on} onSelect={() => void ctx.ops.applyTag(targets, t.id, !on)} />;
        })}
        {ctx.ops.state.tags.length > 0 ? <MenuSeparator /> : null}
        <MenuItem icon="Plus" label="New tag…" onSelect={() => ctx.onNewTag(targets)} />
      </MenuSub>
      <MenuSeparator />
      {ctx.hasMachine ? (
        <>
          <MenuItem lead={<CloudGlyph />} label={onMachine ? "Send to my always-on machine again" : "Send to my always-on machine"} onSelect={() => void machineActions.send(thread)} />
          {onMachine ? <MenuItem icon="ArrowUpRight" label="Watch on my machine" onSelect={() => machineActions.watch(onMachine)} /> : null}
          {onMachine ? <MenuItem icon="Copy" label="Pull results from my machine" onSelect={() => void machineActions.pull(thread.id, onMachine)} /> : null}
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem icon="Check" label={isSelected ? "Deselect" : "Select"} hint="⌘-click" onSelect={() => ctx.onSelectGesture(thread.id, { metaKey: true, ctrlKey: false, shiftKey: false })} />
      {moveTargets && moveTargets.length > 0 ? (
        <MenuSub icon="FolderEdit" label="Move to folder">
          {moveTargets.map((t) => (
            <MenuItem key={t.id ?? "root"} icon={t.id ? "Folder" : "Folder"} label={`${"  ".repeat(t.depth)}${t.label}`} onSelect={() => onMove(t.id)} />
          ))}
        </MenuSub>
      ) : null}
      <MenuItem
        icon="Copy"
        label="Copy link"
        onSelect={() => void navigator.clipboard?.writeText(new URL(thread.href, window.location.origin).toString())}
      />
      <MenuSeparator />
      <MenuItem icon="Archive" label="Archive" onSelect={() => actions.archive(thread.id)} />
      <MenuItem icon="Trash2" label="Delete…" danger onSelect={() => actions.requestDelete(thread.id)} />
    </Menu>
  );
}

/* ------------------------------ sections ------------------------------- */

const DRAG_SECTION = "application/x-nav-section";

function Section({ id, label, numeral, count, actions, onDrop, menu, collapsed, onToggle, onReorder, mark, children }: {
  id: string;
  label: string;
  numeral?: string;
  count: number;
  actions?: ReactNode;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
  menu?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  /** Drop another section header here to put it above this one. */
  onReorder: (draggedId: string, beforeId: string) => void;
  mark?: ReactNode;
  children: ReactNode;
}) {
  const [over, setOver] = useState<"item" | "section" | null>(null);
  const heading = (
    <h3
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_SECTION, id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        caps,
        "group relative mx-1 mb-1.5 flex h-6 cursor-pointer select-none items-center justify-between rounded-md",
        over === "item" && "bg-accent",
      )}
      onClick={onToggle}
      onDragOver={(e) => {
        const isSection = e.dataTransfer.types.includes(DRAG_SECTION);
        if (!isSection && !onDrop) return;
        e.preventDefault();
        setOver(isSection ? "section" : "item");
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        setOver(null);
        const dragged = e.dataTransfer.getData(DRAG_SECTION);
        if (dragged) {
          e.preventDefault();
          if (dragged !== id) onReorder(dragged, id);
          return;
        }
        onDrop?.(e);
      }}
      title="Click to fold · drag to reorder"
    >
      {over === "section" ? <span aria-hidden className="absolute -top-2 left-0 right-0 h-[2px] rounded-full" style={{ background: GOLD }} /> : null}
      <span className="flex min-w-0 items-center gap-2">
        <Icon name="ChevronRight" className={cn("size-3 shrink-0 transition-transform", !collapsed && "rotate-90")} />
        {numeral ? (
          <i className="-ml-0.5 font-serif text-[14px] normal-case tracking-normal" style={{ color: GOLD_INK }}>
            {numeral}
          </i>
        ) : null}
        {mark}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {actions ? <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">{actions}</span> : null}
        <span className="w-5 text-right" style={tnum}>{count}</span>
      </span>
    </h3>
  );
  return (
    <section className="mb-4 border-t border-border pt-3">
      {menu ? <Menu trigger={heading}>{menu}</Menu> : heading}
      {collapsed ? null : children}
    </section>
  );
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

/* -------------------------------- rail --------------------------------- */

type Draft = { kind: "new"; projectId: string; parentId: string | null } | { kind: "rename"; folder: Folder };

export function Rail({ activeThreadId, activeProjectId, onNavigate }: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const actions = useThreadActions();
  const [harness, setHarness] = usePersisted<string | null>("nav-skin:harness", null);
  const [collapsed, setCollapsed] = usePersisted<Record<string, boolean>>("nav-skin:collapsed", {});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirs, setDirs] = useState<Record<string, Directory[] | "loading">>({});
  const [picker, setPicker] = useState<string | null>(null);
  const folders = useFolders(threads.length);
  const ops = useRailState();
  const todoCounts = useFolderTodoCounts();
  const [tagFilter, setTagFilter] = usePersisted<string | null>("nav-skin:tag", null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const orderRef = useRef<string[]>([]);
  const [creatingTag, setCreatingTag] = useState<string[] | null>(null);
  const now = Date.now();

  const activeTag = tagFilter && ops.state.tags.some((t) => t.id === tagFilter) ? tagFilter : null;
  const model = useMemo(
    () => buildModel(threads, projects, folders.available ? folders.data : null, harness, activeProjectId, ops.state, activeTag),
    [threads, projects, folders.available, folders.data, harness, activeProjectId, ops.state, activeTag],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelecting(false);
    anchor.current = null;
  }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && (selected.size > 0 || selecting)) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, selecting, clearSelection]);

  const onSelectGesture = useCallback(
    (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
      if (e.shiftKey && anchor.current) {
        const order = orderRef.current;
        const a = order.indexOf(anchor.current);
        const b = order.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelected((cur) => new Set([...cur, ...order.slice(lo, hi + 1)]));
          return true;
        }
      }
      if (e.metaKey || e.ctrlKey || selecting) {
        setSelected((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchor.current = id;
        return true;
      }
      if (selected.size > 0) setSelected(new Set());
      anchor.current = id;
      return false;
    },
    [selecting, selected.size],
  );
  const machine = useMachine();
  const rowCtx: RowCtx = { ops, machine: machine.items, hasMachine: machine.configured, selecting, selected, onSelectGesture, onNewTag: (ids) => setCreatingTag(ids) };
  const renderOrder: string[] = [];

  const loadDirs = useCallback(
    (projectId: string, folderId: string | null) => {
      const key = `${projectId}:${folderId ?? ""}`;
      if (dirs[key]) return;
      setDirs((d) => ({ ...d, [key]: "loading" }));
      folders.browse(projectId, folderId).then(
        (list) => setDirs((d) => ({ ...d, [key]: list })),
        (e) => { setDirs((d) => ({ ...d, [key]: [] })); report("Listing folders")(e); },
      );
    },
    [dirs, folders],
  );

  if (status === "loading" && threads.length === 0) return <p className={cn(caps, "px-3 py-4")}>Loading the room…</p>;
  if (status === "error") return <p className="px-3 py-4 text-[12px] text-destructive">Could not load threads.</p>;

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const onDropInto = (projectId: string, folderId: string | null) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const t = e.dataTransfer.getData(DRAG_THREAD);
    const f = e.dataTransfer.getData(DRAG_FOLDER);
    if (t) {
      const { id, projectId: from } = JSON.parse(t) as { id: string; projectId: string };
      if (from !== projectId) return toast.error("Chats can only move between folders of the same project.");
      folders.placeThread(id, projectId, folderId).catch(report("Move"));
    } else if (f) {
      const { id, projectId: from } = JSON.parse(f) as { id: string; projectId: string };
      if (from !== projectId || id === folderId) return;
      if (folderId && model.isDescendant(folderId, id)) return toast.error("A folder cannot move inside itself.");
      folders.reparentFolder(id, folderId).catch(report("Move"));
    }
  };

  const renderThread = (t: PluginSidebarThread, depth: number) => {
    renderOrder.push(t.id, ...(model.children.get(t.id) ?? []).map((c) => c.id));
    return (
    <div key={t.id}>
      <ThreadRow
        ctx={rowCtx}
        thread={t}
        active={t.id === activeThreadId}
        depth={depth}
        now={now}
        onNavigate={onNavigate}
        moveTargets={(model.moveTargets.get(t.projectId) ?? []).filter((o) => !o.group)}
        onMove={(folderId) => folders.placeThread(t.id, t.projectId, folderId).catch(report("Move"))}
      />
      {(model.children.get(t.id) ?? []).map((c) => (
        <ThreadRow
          key={c.id}
          ctx={rowCtx}
          thread={c}
          active={c.id === activeThreadId}
          depth={depth + 1}
          now={now}
          onNavigate={onNavigate}
          moveTargets={null}
          onMove={() => undefined}
        />
      ))}
    </div>
    );
  };

  const renderDraft = (projectId: string, parentId: string | null, depth: number) =>
    draft?.kind === "new" && draft.projectId === projectId && draft.parentId === parentId ? (
      <InlineInput
        initial=""
        placeholder="Folder name"
        depth={depth}
        onCancel={() => setDraft(null)}
        onSubmit={(name) => {
          setDraft(null);
          folders.createFolder(projectId, parentId, name).then(() => toast.success(`Created ${slug(name)}`), report("Create folder"));
        }}
      />
    ) : null;

  const renderFolder = (f: Folder, depth: number): ReactNode => {
    const node = model.folderNodes.get(f.id);
    if (!node) return null;
    const isOpen = !collapsed[f.id];
    if (draft?.kind === "rename" && draft.folder.id === f.id) {
      return (
        <InlineInput
          key={f.id}
          initial={f.name}
          placeholder="Folder name"
          depth={depth}
          onCancel={() => setDraft(null)}
          onSubmit={(name) => { setDraft(null); folders.renameFolder(f.projectId, f.id, name).catch(report("Rename")); }}
        />
      );
    }
    const dirKey = `${f.projectId}:${f.id}`;
    const dirList = dirs[dirKey];
    return (
      <div key={f.id}>
        <FolderRow
          folder={f}
          depth={depth}
          open={isOpen}
          count={node.total}
          live={node.live}
          todos={todoCounts.get(f.id) ?? 0}
          onToggle={() => toggle(f.id)}
          onDrop={onDropInto(f.projectId, f.id)}
          onNewChat={f.kind === "group" ? null : () => { goTo(newChatInFolderUrl(f.projectId, f.id)); onNavigate(); }}
          menu={(
            <>
              {f.kind !== "group" ? <MenuItem icon="MessageCirclePlus" label="New chat here" onSelect={() => { goTo(newChatInFolderUrl(f.projectId, f.id)); onNavigate(); }} /> : null}
              <MenuItem icon="FolderPlus" label="New subfolder" onSelect={() => { setCollapsed((c) => ({ ...c, [f.id]: false })); setDraft({ kind: "new", projectId: f.projectId, parentId: f.id }); }} />
              <MenuSub icon="Search" label="Add existing subfolder" onOpen={() => loadDirs(f.projectId, f.id)}>
                <DirectoryItems list={dirList} taken={model.takenPaths} onPick={(d) => folders.createFolder(f.projectId, f.id, d.name, d.relative).catch(report("Add folder"))} />
              </MenuSub>
              <MenuSeparator />
              <MenuItem icon="Edit" label="Rename" onSelect={() => setDraft({ kind: "rename", folder: f })} />
              <MenuSub icon="FolderEdit" label="Move to">
                {(model.moveTargets.get(f.projectId) ?? [])
                  .filter((o) => o.id !== f.id && !(o.id && model.isDescendant(o.id, f.id)))
                  .map((o) => (
                    <MenuItem key={o.id ?? "root"} icon={o.id ? "Folder" : "Folder"} label={`${"  ".repeat(o.depth)}${o.label}`} onSelect={() => folders.reparentFolder(f.id, o.id).catch(report("Move"))} />
                  ))}
              </MenuSub>
              <MenuItem icon="Copy" label="Copy path" hint={f.path.split("/").slice(-1)[0]} onSelect={() => void navigator.clipboard?.writeText(f.path)} />
              <MenuSeparator />
              <MenuItem icon="FolderMinus" label="Remove from rail" hint="keeps files" onSelect={() => folders.forgetFolder(f.projectId, f.id).catch(report("Remove"))} />
            </>
          )}
        />
        {isOpen ? (
          <>
            {renderDraft(f.projectId, f.id, depth + 1)}
            {node.subfolders.map((s) => renderFolder(s, depth + 1))}
            {node.threads.map((t) => renderThread(t, depth + 1))}
          </>
        ) : null}
      </div>
    );
  };

  type Group = (typeof model.groups)[number];
  const renderGroup = (g: Group, sid: string, numeral?: string) => {
    const label = g.project ? (g.project.isPersonal ? "Personal" : g.project.name) : "Other";
    const canFolder = folders.available && g.hasRoot;
    const open = !!expanded[g.id] || g.loose.length <= FOLD + 2;
    const loose = open ? g.loose : g.loose.slice(0, FOLD);
    const rootDirs = dirs[`${g.id}:`];
    const isCollapsed = ops.state.collapsed.includes(sid);
    return (
      <Section
        key={sid}
        id={sid}
        label={label}
        numeral={numeral}
        count={g.total}
        collapsed={isCollapsed}
        onToggle={() => ops.setCollapsed(sid, !isCollapsed)}
        onReorder={reorder}
        onDrop={canFolder ? onDropInto(g.id, null) : undefined}
        actions={
          <>
            <IconButton icon="MessageCirclePlus" label={`New chat in ${label}`} onClick={() => { actions.openNewThread({ projectId: g.id, focusPrompt: true }); onNavigate(); }} />
            {canFolder ? <IconButton icon="FolderPlus" label={`New folder in ${label}`} onClick={() => { if (isCollapsed) ops.setCollapsed(sid, false); setDraft({ kind: "new", projectId: g.id, parentId: null }); }} /> : null}
            {canFolder ? <IconButton icon="FolderOpen" label={`Add folders from the drive to ${label}`} onClick={() => { if (isCollapsed) ops.setCollapsed(sid, false); loadDirs(g.id, null); setPicker((p) => (p === g.id ? null : g.id)); }} /> : null}
          </>
        }
        menu={
          <>
            <MenuLabel>{label}</MenuLabel>
            <MenuItem icon="MessageCirclePlus" label="New chat" onSelect={() => { actions.openNewThread({ projectId: g.id, focusPrompt: true }); onNavigate(); }} />
            {canFolder ? <MenuItem icon="FolderPlus" label="New folder" onSelect={() => setDraft({ kind: "new", projectId: g.id, parentId: null })} /> : null}
            {canFolder ? (
              <MenuSub icon="Search" label="Add existing folder" onOpen={() => loadDirs(g.id, null)}>
                <DirectoryItems list={rootDirs} taken={model.takenPaths} onPick={(d) => folders.createFolder(g.id, null, d.name, d.relative).catch(report("Add folder"))} />
              </MenuSub>
            ) : null}
            <MenuSeparator />
            <MenuItem icon="ChevronsUp" label="Move section to top" onSelect={() => { const first = sections[0]?.id; if (first && first !== sid) reorder(sid, first); }} />
            <MenuItem icon={isCollapsed ? "ChevronsDown" : "ChevronsUp"} label={isCollapsed ? "Unfold section" : "Fold section"} onSelect={() => ops.setCollapsed(sid, !isCollapsed)} />
            {canFolder ? <MenuItem icon="ChevronsUp" label="Collapse all folders" onSelect={() => setCollapsed((c) => ({ ...c, ...Object.fromEntries(g.allFolderIds.map((id) => [id, true])) }))} /> : null}
            {canFolder ? <MenuItem icon="ChevronsDown" label="Expand all folders" onSelect={() => setCollapsed((c) => ({ ...c, ...Object.fromEntries(g.allFolderIds.map((id) => [id, false])) }))} /> : null}
          </>
        }
      >
        {renderDraft(g.id, null, 0)}
        {picker === g.id ? (
          <DrivePicker
            list={rootDirs}
            taken={model.takenPaths}
            onClose={() => setPicker(null)}
            onPick={(d) => folders.createFolder(g.id, null, d.name, d.relative).then(() => toast.success(`Added ${d.name}`), report("Add folder"))}
          />
        ) : null}
        {canFolder && g.folders.length === 0 && picker !== g.id && !(draft?.kind === "new" && draft.projectId === g.id) ? (
          <div className="mx-1 mb-1 flex h-8 items-center gap-3 rounded-md border border-dashed border-border px-2.5 text-[12px] text-muted-foreground">
            <Icon name="Folder" className="size-3.5 opacity-60" />
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => setDraft({ kind: "new", projectId: g.id, parentId: null })}>New folder</button>
            <span aria-hidden>·</span>
            <button type="button" className="hover:text-foreground hover:underline" onClick={() => { loadDirs(g.id, null); setPicker(g.id); }}>Add from drive</button>
          </div>
        ) : null}
        {g.folders.map((f) => renderFolder(f, 0))}
        {loose.map((t) => renderThread(t, 0))}
        <More shown={loose.length} total={g.loose.length} open={open && g.loose.length > FOLD + 2} onToggle={() => setExpanded((o) => ({ ...o, [g.id]: !open }))} />
      </Section>
    );
  };

  const collapsedSet = new Set(ops.state.collapsed);
  const sections: Array<{ id: string; el: (numeral?: string) => ReactNode }> = [];

  if (model.later.length > 0) {
    sections.push({
      id: "later",
      el: () => (
        <Section
          key="later"
          id="later"
          label="Come back later"
          mark={<StatusMark reason="revisit" size={12} />}
          count={model.later.length}
          collapsed={collapsedSet.has("later")}
          onToggle={() => ops.setCollapsed("later", !collapsedSet.has("later"))}
          onReorder={reorder}
        >
          {model.later.map((t) => renderThread(t, 0))}
        </Section>
      ),
    });
  }
  if (model.needs.length > 0) {
    sections.push({
      id: "needs",
      el: () => (
        <Section
          key="needs"
          id="needs"
          label="Needs you"
          count={model.needs.length}
          collapsed={collapsedSet.has("needs")}
          onToggle={() => ops.setCollapsed("needs", !collapsedSet.has("needs"))}
          onReorder={reorder}
          actions={<IconButton icon="Check" label="Select all that need you" onClick={() => { setSelecting(true); setSelected(new Set(model.needs.map((t) => t.id))); }} />}
        >
          {(expanded.__needs ? model.needs : model.needs.slice(0, NEEDS_FOLD)).map((t) => renderThread(t, 0))}
          <More shown={expanded.__needs ? model.needs.length : Math.min(NEEDS_FOLD, model.needs.length)} total={model.needs.length} open={!!expanded.__needs} onToggle={() => setExpanded((o) => ({ ...o, __needs: !o.__needs }))} />
        </Section>
      ),
    });
  }
  if (model.pinned.length > 0) {
    sections.push({
      id: "pinned",
      el: () => (
        <Section
          key="pinned"
          id="pinned"
          label="Pinned"
          count={model.pinned.length}
          collapsed={collapsedSet.has("pinned")}
          onToggle={() => ops.setCollapsed("pinned", !collapsedSet.has("pinned"))}
          onReorder={reorder}
        >
          {model.pinned.map((t) => renderThread(t, 0))}
        </Section>
      ),
    });
  }
  for (const g of model.groups) {
    const sid = `project:${g.id}`;
    sections.push({ id: sid, el: (numeral) => renderGroup(g, sid, numeral) });
  }

  // the member's saved order first; anything new keeps its natural place after.
  const saved = ops.state.order;
  const natural = sections.map((x) => x.id);
  const rank = (id: string) => {
    const i = saved.indexOf(id);
    return i >= 0 ? i : saved.length + natural.indexOf(id);
  };
  sections.sort((a, b) => rank(a.id) - rank(b.id));
  function reorder(dragged: string, before: string) {
    const ids = sections.map((x) => x.id).filter((x) => x !== dragged);
    const at = ids.indexOf(before);
    ids.splice(at < 0 ? ids.length : at, 0, dragged);
    void ops.setOrder(ids);
  }

  let projectIndex = 0;
  const body = sections.map((x) => x.el(x.id.startsWith("project:") ? ROMAN[projectIndex++] : undefined));
  orderRef.current = renderOrder;

  const selectedThreads = threads.filter((t) => selected.has(t.id));

  return (
    <div className="px-2 pb-6 pt-2">
      <NowCard running={model.running} needs={model.allNeeds} onNavigate={onNavigate} />
      <HarnessFilter
        counts={model.counts}
        value={harness}
        onChange={setHarness}
        extra={
          <button
            type="button"
            aria-pressed={selecting}
            title="Select several chats (or ⌘-click, ⇧-click)"
            onClick={() => (selecting ? clearSelection() : setSelecting(true))}
            className={cn(
              "ml-auto inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12px] transition-colors",
              selecting ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon name="ListTodo" className="size-3.5" />
            {selecting ? "Done" : "Select"}
          </button>
        }
      />
      <TagFilter
        ops={ops}
        counts={model.tagCounts}
        value={activeTag}
        onChange={setTagFilter}
        creating={creatingTag !== null}
        setCreating={(v) => setCreatingTag(v ? [] : null)}
        onCreated={(tag) => {
          if (creatingTag && creatingTag.length > 0) void ops.applyTag(creatingTag, tag.id, true);
          setCreatingTag(null);
        }}
      />

      {body}

      {sections.length === 0 ? (
        <p className="mx-1 border-t border-border pt-3 text-[12px] text-muted-foreground">Nothing matches this filter.</p>
      ) : null}
      {!folders.available ? (
        <p className="mx-1 mt-2 text-[11px] text-muted-foreground">Folders need the project-folders plugin.</p>
      ) : null}
      {selected.size > 0 ? (
        <BulkBar
          ids={[...selected]}
          pinnedAll={selectedThreads.length > 0 && selectedThreads.every((t) => t.isPinned)}
          ops={ops}
          onClear={clearSelection}
          onNewTag={() => setCreatingTag([...selected])}
        />
      ) : null}
    </div>
  );
}

function More({ shown, total, open, onToggle }: { shown: number; total: number; open: boolean; onToggle: () => void }) {
  if (total <= shown && !open) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="ml-[30px] mt-1 text-[12px] text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-foreground"
    >
      {open ? "Show fewer" : `Show ${total - shown} more`}
    </button>
  );
}

function DrivePicker({ list, taken, onPick, onClose }: { list: Directory[] | "loading" | undefined; taken: ReadonlySet<string>; onPick: (d: Directory) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const ready = Array.isArray(list);
  const free = ready ? list.filter((d) => !d.name.startsWith(".") && !d.name.startsWith("#") && !taken.has(d.relative.replace(/\/+$/, ""))) : [];
  const shown = free.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="mx-1 mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-2.5">
        <Icon name="Search" className="size-3.5 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          placeholder="Add folders from the drive"
          className="h-8 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <IconButton icon="X" label="Close" onClick={onClose} />
      </div>
      <div className="max-h-[260px] overflow-y-auto py-1">
        {!ready ? <p className="px-3 py-2 text-[12px] text-muted-foreground">Reading the drive…</p> : null}
        {ready && shown.length === 0 ? <p className="px-3 py-2 text-[12px] text-muted-foreground">Nothing left to add here.</p> : null}
        {shown.map((d) => (
          <button
            key={d.relative}
            type="button"
            onClick={() => onPick(d)}
            className="group flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] text-foreground hover:bg-accent"
          >
            <Icon name="Folder" className="size-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <Icon name="Plus" className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
          </button>
        ))}
      </div>
    </div>
  );
}

function DirectoryItems({ list, taken, onPick }: { list: Directory[] | "loading" | undefined; taken: ReadonlySet<string>; onPick: (d: Directory) => void }) {
  if (list === undefined || list === "loading") return <MenuItem label="Reading the drive…" disabled onSelect={() => undefined} />;
  const free = list.filter((d) => !d.name.startsWith(".") && !taken.has(d.relative.replace(/\/+$/, "")));
  if (free.length === 0) return <MenuItem label="No other folders here" disabled onSelect={() => undefined} />;
  return (
    <>
      {free.slice(0, 60).map((d) => (
        <MenuItem key={d.relative} icon="Folder" label={d.name} onSelect={() => onPick(d)} />
      ))}
    </>
  );
}

function FolderRow({ folder, depth, open, count, live, todos, onToggle, onDrop, onNewChat, menu }: {
  folder: Folder;
  depth: number;
  open: boolean;
  count: number;
  live: boolean;
  todos: number;
  onToggle: () => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onNewChat: (() => void) | null;
  menu: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_FOLDER, JSON.stringify({ id: folder.id, projectId: folder.projectId }));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e); }}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      title={folder.path}
      className={cn(
        "group relative flex h-[32px] cursor-pointer select-none items-center gap-2 rounded-md pr-1 text-[13px] font-medium text-foreground outline-none",
        "hover:bg-[var(--state-hover)] focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-accent",
        over && "bg-accent ring-1 ring-[var(--attention)]",
      )}
      style={{ paddingLeft: 6 + depth * 16 }}
    >
      <Icon name="ChevronRight" className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      <Icon name={open ? "FolderOpen" : "Folder"} className="size-4 shrink-0 opacity-75" />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      {live ? <Lattice cell={2} gap={1} label="Something in here is working" /> : null}
      <TodoBadge n={todos} />
      <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {onNewChat ? <IconButton icon="MessageCirclePlus" label={`New chat in ${folder.name}`} onClick={onNewChat} /> : null}
      </span>
      <span className="w-5 shrink-0 text-right text-[11px] font-normal text-muted-foreground" style={tnum}>{count || ""}</span>
    </div>
  );
  return <Menu trigger={row}>{menu}</Menu>;
}

/* ----------------------------- the model ------------------------------- */

type FolderNode = { folder: Folder; subfolders: Folder[]; threads: PluginSidebarThread[]; total: number; live: boolean };

function buildModel(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  data: FolderData | null,
  harness: string | null,
  activeProjectId: string | null,
  rail: { later: Record<string, { reason: string; at: number }>; assign: Record<string, string[]> },
  tagFilter: string | null,
) {
  const live = threads.filter((t) => !t.isHidden && !t.isArchived);
  const ids = new Set(live.map((t) => t.id));
  const children = new Map<string, PluginSidebarThread[]>();
  const roots: PluginSidebarThread[] = [];
  for (const t of live) {
    if (t.parentThreadId && ids.has(t.parentThreadId)) {
      const list = children.get(t.parentThreadId) ?? [];
      list.push(t);
      children.set(t.parentThreadId, list);
    } else roots.push(t);
  }
  for (const list of children.values()) list.sort(byUrgencyThenRecent);

  const counts = new Map<string, [Harness, number]>();
  for (const t of live) {
    const h = harnessOf(t.providerId);
    const entry = counts.get(h.key) ?? [h, 0];
    entry[1] += 1;
    counts.set(h.key, entry);
  }
  const tagCounts = new Map<string, number>();
  for (const t of roots) for (const id of rail.assign[t.id] ?? []) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  const match = (t: PluginSidebarThread) =>
    (harness === null || harnessOf(t.providerId).key === harness) && (tagFilter === null || (rail.assign[t.id] ?? []).includes(tagFilter));
  const shown = roots.filter(match);
  const isLater = (t: PluginSidebarThread) => rail.later[t.id] !== undefined;
  const running = live.filter((t) => stateOf(t) === "running" && match(t)).sort((a, b) => b.updatedAt - a.updatedAt);
  const later = shown.filter(isLater).sort((a, b) => (rail.later[b.id]?.at ?? 0) - (rail.later[a.id]?.at ?? 0));
  const needs = shown.filter((t) => !isLater(t) && stateOf(t) === "needs").sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = shown.filter((t) => !isLater(t) && t.isPinned && stateOf(t) !== "needs").sort(byUrgencyThenRecent);
  const rest = shown.filter((t) => !isLater(t) && !t.isPinned && stateOf(t) !== "needs");

  // Folder index
  const folderList = (data?.folders ?? []).filter((f) => (f.kind ?? "folder") === "folder" || f.kind === "group");
  const folderIds = new Set(folderList.map((f) => f.id));
  const byParent = new Map<string, Folder[]>();
  for (const f of folderList) {
    const key = `${f.projectId}:${f.parentId && folderIds.has(f.parentId) ? f.parentId : ""}`;
    const list = byParent.get(key) ?? [];
    list.push(f);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  const parentOf = new Map(folderList.map((f) => [f.id, f.parentId && folderIds.has(f.parentId) ? f.parentId : null]));
  const isDescendant = (candidate: string, ancestor: string) => {
    let cur: string | null | undefined = candidate;
    while (cur) {
      if (cur === ancestor) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };

  const threadsByFolder = new Map<string, PluginSidebarThread[]>();
  const looseByProject = new Map<string, PluginSidebarThread[]>();
  for (const t of rest) {
    const fid = data ? folderOfThread(data, folderIds, t.id, t.environment?.id ?? null) : null;
    if (fid) {
      const list = threadsByFolder.get(fid) ?? [];
      list.push(t);
      threadsByFolder.set(fid, list);
    } else {
      const list = looseByProject.get(t.projectId) ?? [];
      list.push(t);
      looseByProject.set(t.projectId, list);
    }
  }

  const folderNodes = new Map<string, FolderNode>();
  const walk = (f: Folder): FolderNode => {
    const subfolders = byParent.get(`${f.projectId}:${f.id}`) ?? [];
    const own = (threadsByFolder.get(f.id) ?? []).sort(byUrgencyThenRecent);
    let total = own.length;
    let isLive = own.some((t) => stateOf(t) === "running");
    for (const s of subfolders) {
      const n = walk(s);
      total += n.total;
      isLive = isLive || n.live;
    }
    const node = { folder: f, subfolders, threads: own, total, live: isLive };
    folderNodes.set(f.id, node);
    return node;
  };

  const rootIds = new Set((data?.roots ?? []).map((r) => r.projectId));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const projectIds = new Set<string>([...looseByProject.keys(), ...folderList.map((f) => f.projectId)]);
  const moveTargets = new Map<string, Array<{ id: string | null; label: string; depth: number; group?: boolean }>>();
  const takenPaths = new Set<string>();

  const groups = [...projectIds].map((id) => {
    const project = projectById.get(id);
    const top = byParent.get(`${id}:`) ?? [];
    let total = 0;
    for (const f of top) total += walk(f).total;
    const loose = (looseByProject.get(id) ?? []).sort(byUrgencyThenRecent);
    total += loose.length;
    const options: Array<{ id: string | null; label: string; depth: number; group?: boolean }> = [{ id: null, label: project?.name ?? "Project root", depth: 0 }];
    const allFolderIds: string[] = [];
    const root = (data?.roots ?? []).find((r) => r.projectId === id);
    const collect = (f: Folder, depth: number) => {
      options.push({ id: f.id, label: f.name, depth, group: f.kind === "group" });
      allFolderIds.push(f.id);
      if (root && f.path.startsWith(root.path)) takenPaths.add(f.path.slice(root.path.length).replace(/^\/+/, "").replace(/\/+$/, ""));
      for (const s of byParent.get(`${id}:${f.id}`) ?? []) collect(s, depth + 1);
    };
    for (const f of top) collect(f, 1);
    moveTargets.set(id, rootIds.has(id) ? options : []);
    const latest = Math.max(0, ...loose.map((t) => t.updatedAt), ...top.flatMap((f) => (folderNodes.get(f.id)?.threads ?? []).map((t) => t.updatedAt)));
    return { id, project, folders: top, loose, total, latest, hasRoot: rootIds.has(id), allFolderIds };
  });
  groups.sort(
    (a, b) =>
      Number(b.id === activeProjectId) - Number(a.id === activeProjectId) ||
      Number(a.project?.isPersonal ?? false) - Number(b.project?.isPersonal ?? false) ||
      b.latest - a.latest,
  );

  return {
    counts: [...counts.values()].sort((a, b) => b[1] - a[1]),
    running,
    later,
    needs,
    pinned,
    groups,
    tagCounts,
    children,
    folderNodes,
    moveTargets,
    takenPaths,
    isDescendant,
    allNeeds: live.filter((t) => stateOf(t) === "needs").length,
  };
}

/* --------------------------- NOW and filter ---------------------------- */

function NowCard({ running, needs, onNavigate }: { running: PluginSidebarThread[]; needs: number; onNavigate: () => void }) {
  const lead = running[0];
  const v = useVoiceState();
  const nav = useBbNavigate();
  const mood = v.status === "connecting" ? "connecting" : v.status === "on" ? (v.mode === "speaking" ? "speaking" : "listening") : running.length > 0 ? "busy" : "idle";
  return (
    <div className="mx-1 mb-5 mt-1 rounded-lg border border-border bg-card px-3.5 pb-0 pt-3 shadow-sm">
      <div className="flex gap-3">
      <div className="pb-3 pt-0.5">
        <LogoOrb size={58} mood={mood} onClick={() => nav.toPluginPanel("home")} title="NavAIgate Home" />
      </div>
      <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between">
        <span className={cn(caps, "flex min-w-0 items-center gap-2 whitespace-nowrap text-foreground")}>
          {running.length > 0 ? <Lattice cell={3} gap={1.5} /> : <span aria-hidden className="inline-block size-[6px] bg-muted-foreground" />}
          {running.length > 0 ? `Now · ${running.length} cooking` : "Now · quiet"}
        </span>
        {needs > 0 ? <span className="ml-2 shrink-0 whitespace-nowrap text-[11px] font-medium text-destructive" style={tnum}>{needs} need you</span> : null}
      </div>
      {lead ? (
        <a href={lead.href} onClick={onNavigate} className="mt-1.5 block truncate text-[14px] font-semibold text-foreground no-underline hover:underline">
          {lead.displayTitle}
        </a>
      ) : (
        <p className="mt-1.5 text-[14px] font-semibold text-foreground">Nothing running</p>
      )}
      <p className="mt-0.5 truncate pb-3 text-[12px] text-muted-foreground">
        {lead ? (running.length > 1 ? `${harnessOf(lead.providerId).label} · and ${running.length - 1} more` : harnessOf(lead.providerId).label) : "Every harness is parked"}
      </p>
      </div>
      </div>
      <div aria-hidden className="-mx-3.5 h-[2px] overflow-hidden rounded-b-lg bg-border">
        {running.length > 0 ? <div className="h-full w-2/5 animate-pulse" style={{ background: GOLD }} /> : null}
      </div>
    </div>
  );
}

function HarnessFilter({ counts, value, onChange, extra }: { counts: Array<[Harness, number]>; value: string | null; onChange: (key: string | null) => void; extra?: ReactNode }) {
  const item = (key: string | null, label: string, n: number) => {
    const on = value === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        aria-pressed={on}
        onClick={() => onChange(key)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
          on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        <span className="opacity-60" style={tnum}>{n}</span>
      </button>
    );
  };
  const total = counts.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="mx-1 mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by harness">
      {item(null, "All", total)}
      {counts.map(([h, n]) => item(h.key, h.label, n))}
      {extra}
    </div>
  );
}
