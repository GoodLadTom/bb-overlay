// Small chips in the row under the chat box, after bb's folder, checkout and (+)
// items: hold a message for sub-agents, move the chat to your always-on machine,
// and, for Claude chats, the pooled account the chat runs on.
//
// bb has no slot there, so (like the usage dock and the new-thread hero) an app
// overlay places a span at the end of the footer's left group and portals into
// it, re-placing it with a MutationObserver when bb re-renders the footer.
// In a chat (/threads/) the chips show; on the new-thread screen "Run on <machine>"
// (switches bb's machine picker to the always-on machine) and the account chip, the
// latter only while a Claude model is picked. Every chip hides itself when what it
// needs is not there: no always-on machine set up, no bb machine of that name, or no
// accounts in bb's Account Pooler.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import * as DM from "@radix-ui/react-dropdown-menu";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import type { PoolList } from "../server-pool";
import type { HostMachine } from "../server-machines";
import { CloudGlyph, machineTone, useMachine, useMachineActions } from "./machine";
import { useComposerHandle } from "./composer-bridge";
import { HoldChip } from "./composer-chips-hold";
import { usePortalScopeProps } from "@/lib/portal-scope";

const CHAT_FOOTER = "[data-follow-up-composer-footer]";
const NEW_FOOTER = "[data-new-thread-footer]";
const CLAUDE_MODEL = /\b(opus|sonnet|haiku|fable|claude)\b/i;

type Place = { slot: HTMLElement; where: "chat" | "new"; newIsClaude: boolean } | null;

function usePlace(): Place {
  const [place, setPlace] = useState<Place>(null);
  useEffect(() => {
    let current: HTMLElement | null = null;
    let last = "";
    let scheduled = false;
    const sync = () => {
      scheduled = false;
      const p = window.location.pathname;
      const inChat = p.includes("/threads/");
      const isNew = !inChat && !p.startsWith("/plugins/") && !p.startsWith("/settings");
      const footer = inChat ? document.querySelector<HTMLElement>(CHAT_FOOTER) : isNew ? document.querySelector<HTMLElement>(NEW_FOOTER) : null;
      const left = footer?.firstElementChild as HTMLElement | null | undefined;
      if (!left) {
        if (current) {
          current.remove();
          current = null;
          last = "";
          setPlace(null);
        }
        return;
      }
      let moved = false;
      if (!current || !current.isConnected || current.parentElement !== left) {
        current?.remove();
        current = document.createElement("span");
        current.setAttribute("data-bb-plugin-root", "");
        current.setAttribute("data-bb-plugin", "navaigate-workspace");
        current.setAttribute("data-nav-composer-chips", "");
        current.className = "flex min-w-0 shrink-0 items-center gap-0.5 pl-1";
        left.appendChild(current);
        moved = true;
      } else if (left.lastElementChild !== current) {
        // bb re-rendered its items after ours; move the same node back to the end.
        left.appendChild(current);
      }
      let newIsClaude = false;
      if (!inChat) {
        const form = document.querySelector<HTMLElement>('[data-app-composer-role="primary"] form');
        newIsClaude = CLAUDE_MODEL.test(form?.innerText ?? "");
      }
      const key = `${inChat ? "chat" : "new"}:${newIsClaude}`;
      if (moved || key !== last) {
        last = key;
        setPlace({ slot: current, where: inChat ? "chat" : "new", newIsClaude });
      }
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(sync);
    };
    sync();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("popstate", schedule);
    return () => {
      mo.disconnect();
      window.removeEventListener("popstate", schedule);
      current?.remove();
    };
  }, []);
  return place;
}

const chip =
  "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs leading-tight text-muted-foreground transition-colors " +
  "hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-hover data-[state=open]:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-[var(--attention)]";

const panel =
  "z-50 min-w-[248px] max-w-[320px] overflow-hidden rounded-lg border border-border bg-popover p-1 text-[13px] text-foreground shadow-lg " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";

const row =
  "relative flex h-8 cursor-default select-none items-center gap-2.5 rounded-md pl-3 pr-2 outline-none " +
  "data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-45 " +
  "before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-transparent data-[highlighted]:before:bg-[var(--attention)]";

function Heading({ children }: { children: ReactNode }) {
  return <DM.Label className="px-3 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{children}</DM.Label>;
}
function Muted({ children }: { children: ReactNode }) {
  return <div className="px-3 pb-2 pt-1 text-[11.5px] leading-snug text-muted-foreground">{children}</div>;
}
function Sep() {
  return <DM.Separator className="mx-2 my-1 h-px bg-border" />;
}

function Pop({ trigger, children, open, onOpenChange }: { trigger: ReactNode; children: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const scope = usePortalScopeProps();
  return (
    <DM.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content {...scope} className={panel} side="top" align="start" sideOffset={6} collisionPadding={8}>
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/* ------------------------ Move to your always-on machine ------------------------ */

type Thread = { id: string; displayTitle: string; providerId: string };
type Link = { from: string | null; to: string | null; via: "machine" | "handoff" | null; branch: string | null; at: number | null; onMachine: boolean };

function useTeleportLink(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [link, setLink] = useState<Link | null>(null);
  const refetch = useCallback(() => {
    rpc.call("teleport_link", { threadId }).then(setLink, () => setLink(null));
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  useRealtime("teleport", refetch);
  return link;
}

function MachineChip({ thread }: { thread: Thread }) {
  const state = useMachine();
  const actions = useMachineActions();
  const name = state.label || "your always-on machine";
  const nav = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const link = useTeleportLink(thread.id);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState<{ files: number; branch: string | null } | null>(null);
  useEffect(() => {
    if (!open) setDirty(null);
  }, [open]);
  const item = state.items[thread.id];

  const report = (res: { newThreadId: string | null; via: string | null; url: string | null; notes: string[] }, t: string | number, back = false) => {
    const where = back ? "Back on this computer" : res.via === "machine" ? `Moved to ${name}` : `Handed to the bb on ${name}`;
    toast.success(where, {
      id: t,
      description: [res.via === "handoff" ? `bb cannot fork a chat across machines, so ${name} got a brief of this one.` : null, ...res.notes].filter(Boolean).join(" ") || undefined,
      action: res.url ? { label: "Watch", onClick: () => window.open(res.url ?? "", "_blank", "noopener") } : undefined,
    });
    if (res.newThreadId && res.via === "machine") nav.toThread(res.newThreadId);
  };
  const fail = (t: string | number, what: string) => (e: unknown) => toast.error(what, { id: t, description: e instanceof Error ? e.message : String(e) });

  const move = (choice?: "carry" | "leave") => {
    setBusy(true);
    const t = toast.loading(`Moving this chat to ${name}…`, { description: "Stopping it here, pushing the work and writing the brief." });
    rpc
      .call("teleport_move", choice ? { threadId: thread.id, dirty: choice } : { threadId: thread.id })
      .then((res) => {
        if (res.needs) {
          toast.dismiss(t);
          setDirty({ files: res.needs.files, branch: res.needs.branch });
          setOpen(true);
          return;
        }
        setOpen(false);
        report(res, t);
      }, fail(t, "Not moved"))
      .finally(() => setBusy(false));
  };
  const bringBack = () => {
    setBusy(true);
    const t = toast.loading("Bringing this chat back to this computer…");
    rpc
      .call("teleport_back", { threadId: thread.id })
      .then((res) => report(res, t, true), fail(t, "Not brought back"))
      .finally(() => setBusy(false));
  };

  if (!state.configured && !link?.onMachine) return null;
  if (link?.onMachine) {
    return (
      <Pop
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button type="button" className={chip} disabled={busy} title={`This chat runs on ${name}, a machine of this bb`}>
            <CloudGlyph size={13} color="var(--attention)" />
            {busy ? "Bringing back…" : `On ${name}`}
          </button>
        }
      >
        <Heading>On {name}</Heading>
        <Muted>This chat runs on {name}, inside this bb.{link.from ? " It came from a chat on this computer, which is archived." : ""}</Muted>
        <Sep />
        <DM.Item className={row} onSelect={bringBack}>
          <span className="size-[14px]" />
          <span className="flex-1">Bring it back to this computer</span>
        </DM.Item>
        <Muted>
          {link.from ? "Restores the original chat and hands it what happened here, " : "Starts a chat on this computer from a brief of this one, "}
          then archives this one. {link.branch ? `Code comes back on ${link.branch}.` : ""}
        </Muted>
      </Pop>
    );
  }
  if (item) {
    // Same as the header button: status, and it opens the "On your machine" panel.
    const t = machineTone(item.status);
    return (
      <button type="button" className={chip} title={`On ${name}: ${t.label}. Click to see what it is doing.`} onClick={() => nav.openThreadPanel({ actionId: "machine", title: "On your machine" })}>
        <span className={t.pulse ? "inline-flex animate-pulse" : "inline-flex"}>
          <CloudGlyph size={13} color={t.color} />
        </span>
        On {name}
      </button>
    );
  }
  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={chip} disabled={busy} title={`Move this chat to ${name}, or send it a brief`}>
          <CloudGlyph size={13} color="var(--attention)" />
          {busy ? "Moving…" : name}
        </button>
      }
    >
      {dirty ? (
        <>
          <Heading>Uncommitted changes</Heading>
          <Muted>
            {dirty.files} file{dirty.files === 1 ? "" : "s"} changed and not committed{dirty.branch ? ` on ${dirty.branch}` : ""}. Carry them over as a WIP commit on teleport/{thread.id}; your
            branch and working tree stay as they are.
          </Muted>
          <Sep />
          <DM.Item className={row} onSelect={() => move("carry")}>
            <CloudGlyph size={14} color="var(--attention)" />
            <span className="flex-1">Carry them over</span>
          </DM.Item>
          <DM.Item className={row} onSelect={() => move("leave")}>
            <span className="size-[14px]" />
            <span className="flex-1">Move without them</span>
          </DM.Item>
          <DM.Item className={row} onSelect={() => setDirty(null)}>
            <span className="size-[14px]" />
            <span className="flex-1 text-muted-foreground">Cancel</span>
          </DM.Item>
        </>
      ) : (
        <>
          <Heading>Move to {name}</Heading>
          <Muted>
            Stops this chat here, pushes the work, starts it again on {name} from a brief of the conversation and archives this one (restorable). bb cannot fork a chat across
            machines, so the new chat starts from the brief, not the full history.
          </Muted>
          <Sep />
          <DM.Item className={row} disabled={busy} onSelect={(e) => { e.preventDefault(); move(); }}>
            <CloudGlyph size={14} color="var(--attention)" />
            <span className="flex-1">Move this chat to {name}</span>
          </DM.Item>
          <DM.Item
            className={row}
            onSelect={() => {
              setBusy(true);
              void actions.send(thread).finally(() => setBusy(false));
            }}
          >
            <span className="size-[14px]" />
            <span className="flex-1">Only send {name} a brief</span>
          </DM.Item>
          <Muted>The brief goes to the bb on {name} and this chat stays here.</Muted>
        </>
      )}
    </Pop>
  );
}

/* ----------------------------- Claude account ----------------------------- */

function usePool() {
  const rpc = useRpc<typeof rpcContract>();
  const [pool, setPool] = useState<PoolList | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("pool_list").then(setPool, () => undefined);
    rpc.call("pool_account", { provider: "claude", sessionId: null }).then((r) => setActive(r.activeAccountId), () => undefined);
  }, [rpc]);
  useEffect(() => {
    refetch();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [refetch]);
  useRealtime("pool-order", refetch);
  return { pool, setPool, active, refetch };
}

/** The pooled account this chat is pinned to (null until its first turn has gone through the pool). */
function useThreadAccount(threadId: string | null) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    setPinned(null);
    if (!threadId) return;
    let stop = false;
    const load = async () => {
      const r = (await sdk.threads.context({ threadId })) as unknown as { usage: null | { snapshot?: { providerSessionId?: string } } };
      const sessionId = r.usage?.snapshot?.providerSessionId ?? null;
      if (!sessionId) return;
      const { accountId } = await rpc.call("pool_account", { provider: "claude", sessionId });
      if (!stop) setPinned(accountId);
    };
    void load().catch(() => undefined);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => undefined);
    }, 60_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [threadId, sdk, rpc]);
  return pinned;
}

function AccountDot() {
  return <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: "var(--attention)" }} />;
}

function AccountChip({ threadId }: { threadId: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const { pool, setPool, active, refetch } = usePool();
  const pinned = useThreadAccount(threadId);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);
  const accounts = pool?.accounts ?? [];
  if (accounts.length === 0) return null;
  const byId = (id: string | null) => accounts.find((a) => a.id === id) ?? null;
  const activeAcc = byId(active);
  const mine = threadId ? (byId(pinned) ?? activeAcc) : activeAcc;
  const first = accounts[0];
  const label = mine ? mine.short : "pool";
  const title = threadId
    ? pinned
      ? `This chat runs on ${mine?.email ?? label}. It stays on that account.`
      : `This chat has not been pinned yet; its next turn goes to ${activeAcc?.email ?? "the pool's current account"}.`
    : `New Claude chats start on ${activeAcc?.email ?? "the pool's current account"}.`;

  const putFirst = (id: string) => {
    const target = byId(id);
    const t = toast.loading(`Putting ${target?.short ?? "that account"} first…`);
    rpc.call("pool_put_first", { accountId: id }).then(
      (res) => {
        setPool(res);
        refetch();
        toast.success("Failover order changed", { id: t, description: `Now ${res.accounts.map((a) => `${a.short} (${a.priority})`).join(", then ")}. New chats stay on the current account until it hits its limit.` });
      },
      (e: unknown) => toast.error("Order not changed", { id: t, description: e instanceof Error ? e.message : String(e) }),
    );
  };

  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={chip} title={title}>
          <AccountDot />
          Claude · {label}
        </button>
      }
    >
      <Heading>Claude accounts</Heading>
      {accounts.map((a) => {
        const tags = [threadId && mine?.id === a.id ? "this chat" : null, active === a.id ? "new chats" : null, a.enabled ? null : "off"].filter(Boolean);
        return (
          <div key={a.id} className="flex items-center gap-2.5 px-3 py-1.5">
            <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: tags.includes("this chat") || (!threadId && active === a.id) ? "var(--attention)" : "var(--border)" }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{a.short}</span>
                {tags.map((t) => (
                  <span key={t as string} className="rounded-[4px] border border-border px-1 text-[10px] leading-[14px] text-muted-foreground">
                    {t}
                  </span>
                ))}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{a.email}</div>
            </div>
            <div className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              <div>
                <span className="text-foreground">{a.weekPct ?? "–"}%</span> week
              </div>
              <div>{a.sessionPct ?? "–"}% session</div>
            </div>
          </div>
        );
      })}
      <Sep />
      <Heading>Failover order</Heading>
      <Muted>{accounts.map((a) => a.short).join(", then ")}</Muted>
      {accounts.length > 1
        ? accounts.map((a) => (
            <DM.Item key={a.id} className={row} disabled={a.id === first.id} onSelect={() => putFirst(a.id)}>
              <span className="size-1.5" />
              <span className="flex-1">Put {a.short} first</span>
              {a.id === first.id ? <span className="text-[11px] text-muted-foreground">first now</span> : null}
            </DM.Item>
          ))
        : null}
      <Sep />
      <Muted>
        {threadId && mine ? `This chat stays on ${mine.short}. ` : ""}
        New chats go to {activeAcc?.short ?? "the pool's current account"} until it hits its limit, then move on in this order. The pool cannot move a running chat to another account.
      </Muted>
    </Pop>
  );
}


/* ---------------------------- Run on your machine ----------------------------- */
// The always-on machine can also be a machine of THIS bb (Settings, Machines, with the
// same name as in Set up). On the new-thread screen this chip switches bb's own machine
// picker to it, in the project's checkout there, so the next chat runs there but stays here.

function MachineGlyph({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

type Env = { type: string; hostId?: string; machine?: { type: string; hostId?: string } | null; workspace?: { type: string; path?: string | null } };
/** The machine a composer selection runs on: a host environment names it directly, a provider one (project checkout) through `machine`. */
const hostOf = (env: Env | null | undefined) => env?.hostId ?? env?.machine?.hostId ?? null;

function useHostMachine(projectId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [m, setM] = useState<HostMachine | null>(null);
  const refetch = useCallback(() => {
    rpc.call("machine_host", { projectId }).then(setM, () => setM(null));
  }, [rpc, projectId]);
  useEffect(() => {
    setM(null);
    refetch();
  }, [refetch]);
  return { m, setM, refetch };
}

function RunOnMachineChip() {
  const handle = useComposerHandle(null);
  const rpc = useRpc<typeof rpcContract>();
  const scope = handle?.api.scope;
  const projectId = scope?.kind === "new-thread" ? scope.projectId : null;
  const { m, setM, refetch } = useHostMachine(projectId);
  const [env, setEnv] = useState<Env | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const readSelection = useCallback(() => {
    if (!handle) return;
    handle.api.experimental_setSelection({}).then((sel) => setEnv((sel.environment as Env | undefined) ?? null), () => undefined);
  }, [handle]);
  useEffect(readSelection, [readSelection, projectId]);
  useEffect(() => {
    if (open) {
      refetch();
      readSelection();
    }
  }, [open, refetch, readSelection]);

  if (!handle || !m?.hostId) return null;
  const name = m.label || "your always-on machine";
  const onIt = hostOf(env) === m.hostId;

  const select = async (target: "there" | "here", state: HostMachine) => {
    const path = target === "there" ? state.sourcePath : state.localPath;
    const hostId = target === "there" ? state.hostId : state.localHostId;
    if (!path || !hostId) return;
    const sel = await handle.api.experimental_setSelection({ environment: { type: "host", hostId, workspace: { type: "unmanaged", path } } });
    setEnv((sel.environment as Env | undefined) ?? null);
    const landed = hostOf(sel.environment as Env | undefined) === hostId;
    if (!landed) toast.error("The machine picker did not switch", { description: "Pick the machine in bb's own picker under the chat box." });
    else if (target === "there") toast.success(`The next chat runs on ${name}`, { description: `In ${path} on ${name}. It stays in this bb, so you see it here as usual.` });
    else toast.success("The next chat runs on this computer");
  };

  const setUp = async () => {
    if (!projectId) return;
    setBusy(true);
    const t = toast.loading(`Setting the project up on ${name}…`);
    try {
      const next = await rpc.call("machine_host_link", { projectId });
      setM(next);
      toast.success(`${name} has this project now`, { id: t, description: next.sourcePath ?? undefined });
      await select("there", next);
    } catch (e) {
      toast.error(`Not set up on ${name}`, { id: t, description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const title = onIt ? `The next chat runs on ${name}` : `Start the next chat on ${name}, in this bb`;
  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={chip} title={title} disabled={busy}>
          <MachineGlyph size={13} color={onIt ? "var(--attention)" : m.connected ? "currentColor" : "var(--muted-foreground)"} />
          {onIt ? `On ${name}` : `Run on ${name}`}
        </button>
      }
    >
      <Heading>Run on {name}</Heading>
      <Muted>
        The chat runs on {name} and stays in this bb, so it shows in the sidebar like any other. This computer must stay awake: it is the bb server {name} reports to.
      </Muted>
      {!m.connected ? <Muted>{name} is not connected right now (asleep, offline, or its bb machine service stopped).</Muted> : null}
      <Sep />
      {m.sourcePath ? (
        onIt ? (
          <DM.Item className={row} disabled={!m.localPath} onSelect={() => void select("here", m)}>
            <span className="size-[14px]" />
            <span className="flex-1">Run it on this computer instead</span>
          </DM.Item>
        ) : (
          <DM.Item className={row} disabled={!m.connected} onSelect={() => void select("there", m)}>
            <MachineGlyph size={14} color="var(--attention)" />
            <span className="flex-1">Start this chat on {name}</span>
          </DM.Item>
        )
      ) : m.suggestedPath ? (
        <DM.Item className={row} disabled={!m.connected || busy} onSelect={() => void setUp()}>
          <MachineGlyph size={14} color="var(--attention)" />
          <span className="min-w-0 flex-1 truncate" title={m.suggestedPath}>
            Set this project up on {name}
          </span>
        </DM.Item>
      ) : (
        <Muted>This project has no folder here to match on {name}.</Muted>
      )}
      {m.sourcePath || m.suggestedPath ? <Muted>{m.sourcePath ? `On ${name}: ${m.sourcePath}` : `It would use ${m.suggestedPath} on ${name}.`}</Muted> : null}
    </Pop>
  );
}

/* --------------------------------- overlay -------------------------------- */

export function ComposerChips() {
  const place = usePlace();
  const { threadId } = useBbContext();
  const { threads } = useSidebarThreads();
  if (!place) return null;
  if (place.where === "chat") {
    const thread = threadId ? threads.find((t) => t.id === threadId) : undefined;
    if (!thread) return null;
    return createPortal(
      <>
        <HoldChip threadId={thread.id} />
        <MachineChip thread={thread} />
        {thread.providerId === "claude-code" ? <AccountChip threadId={thread.id} /> : null}
      </>,
      place.slot,
    );
  }
  return createPortal(
    <>
      <RunOnMachineChip />
      {place.newIsClaude ? <AccountChip threadId={null} /> : null}
    </>,
    place.slot,
  );
}

