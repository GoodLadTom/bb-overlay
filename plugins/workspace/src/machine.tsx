// "On your machine": chats handed over to the always-on machine (home Mac, mini PC
// or VPS). The server polls its bb; here we show a cloud on the row (colour = status
// there), and the row menu can send a chat over, open it there, or pull its results back.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useBbNavigate, useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { MachineState } from "../server-machine";
import type { rpcContract } from "../server";

export type MachineItem = MachineState["items"][string];

const EMPTY: MachineState = { configured: false, label: "", reachable: null, items: {} };

export function useMachine() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<MachineState>(EMPTY);
  const refetch = useCallback(() => {
    rpc.call("machine_state").then(setState, () => undefined);
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("machine-handoffs", refetch);
  useRealtime("profile", refetch);
  return state;
}

/** Where a status lands: working, finished, failed, or not known right now. */
function tone(status: string): { color: string; label: string; pulse: boolean } {
  if (["active", "starting", "running", "provisioning", "queued"].includes(status)) return { color: "var(--attention)", label: "working", pulse: true };
  if (status === "idle") return { color: "var(--success)", label: "finished", pulse: false };
  if (["error", "failed"].includes(status)) return { color: "var(--destructive)", label: "stopped with an error", pulse: false };
  if (status === "stopped") return { color: "var(--muted-foreground)", label: "stopped", pulse: false };
  return { color: "var(--muted-foreground)", label: "status unknown (machine not reachable)", pulse: false };
}

export function CloudGlyph({ size = 13, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

const open = (url: string) => window.open(url, "_blank", "noopener");

/** The cloud on a chat row. Clicking it opens the chat with its "On your machine" panel. */
export function MachineMark({ item, threadId }: { item: MachineItem; threadId: string }) {
  const nav = useBbNavigate();
  const t = tone(item.status);
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    nav.toThread(threadId);
    window.setTimeout(() => nav.openThreadPanel({ actionId: "machine", title: "On your machine" }), 400);
  };
  return (
    <span
      role="link"
      tabIndex={-1}
      onClick={onClick}
      title={`On your machine: ${t.label}. Click to see it.`}
      className={t.pulse ? "inline-flex shrink-0 animate-pulse cursor-pointer" : "inline-flex shrink-0 cursor-pointer"}
    >
      <CloudGlyph size={14} color={t.color} />
    </span>
  );
}

export function useMachineActions() {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const say = (threadId: string, text: string) =>
    sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] });
  return {
    /** The plugin writes the brief from the conversation and sends it, so a stuck chat can still be handed over. */
    send: (thread: { id: string; displayTitle: string; providerId: string }) => {
      const id = toast.loading("Sending to your always-on machine…", { description: "Reading the chat and writing the handoff." });
      return rpc.call("machine_handoff", { threadId: thread.id, title: thread.displayTitle, providerId: thread.providerId }).then(
        (res) =>
          toast.success("On your always-on machine now", {
            id,
            description: res.notes.length ? res.notes.join(" · ") : "The cloud on this chat shows how it's doing.",
            action: res.url ? { label: "Watch", onClick: () => open(res.url) } : undefined,
          }),
        (e: unknown) => toast.error("Send to your always-on machine failed", { id, description: e instanceof Error ? e.message : String(e) }),
      );
    },
    watch: (item: MachineItem) => (item.url ? open(item.url) : toast.error("No link for this chat on your always-on machine")),
    pull: (threadId: string, item: MachineItem) =>
      say(threadId, `Use the always-on skill: run \`always-on pull ${item.remoteThread}\` to bring that chat's results to this laptop, then list the local files.`).then(
        () => toast.success("Pulling the results from your always-on machine"),
        (e: unknown) => toast.error("Pull failed", { description: e instanceof Error ? e.message : String(e) }),
      ),
  };
}

/* ------------------- watching your always-on machine from inside the chat ------------------- */

type MachineLog = { mapped: boolean; remoteThread: string; url: string; log: string; error: string | null };

/** The remote side of this chat, refreshed every 10 seconds while shown. */
function useMachineLog(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<MachineLog | null>(null);
  const load = useCallback(() => {
    rpc.call("machine_log", { threadId }).then(setData, () => undefined);
  }, [rpc, threadId]);
  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10_000);
    return () => window.clearInterval(t);
  }, [load]);
  return { data, reload: load };
}

/** Top-right button on a chat that has been sent to your always-on machine: status, and opens the panel. */
export function MachineHeaderButton({ threadId }: { threadId: string }) {
  const state = useMachine();
  const nav = useBbNavigate();
  const item = state.items[threadId];
  if (!item) return null;
  const t = tone(item.status);
  return (
    <button
      type="button"
      title="See what your always-on machine is doing with this chat"
      onClick={() => nav.openThreadPanel({ actionId: "machine", title: "On your machine" })}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <span className={t.pulse ? "inline-flex animate-pulse" : "inline-flex"}>
        <CloudGlyph size={13} color={t.color} />
      </span>
      Always-on · {t.label.split(" (")[0]}
    </button>
  );
}

/** Side panel: the remote chat's recent turns, live, with a reply box and Pull results. */
export function MachinePanel({ threadId }: { threadId: string }) {
  const state = useMachine();
  const item = state.items[threadId];
  const { data, reload } = useMachineLog(threadId);
  const rpc = useRpc<typeof rpcContract>();
  const actions = useMachineActions();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Newest at the bottom, like the chat itself.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [data?.log]);

  if (!item && data && !data.mapped) {
    return (
      <div className="p-4 text-[12.5px] text-muted-foreground">
        This chat hasn't been sent to your always-on machine. Right-click it in the sidebar and choose "Send to my always-on machine".
      </div>
    );
  }
  const t = tone(item?.status ?? "unknown");
  const send = () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    rpc.call("machine_tell", { threadId, text: body }).then(
      () => {
        setText("");
        toast.success("Sent to your always-on machine");
        window.setTimeout(reload, 1500);
      },
      (e: unknown) => toast.error("Not sent", { description: e instanceof Error ? e.message : String(e) }),
    ).finally(() => setSending(false));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[12.5px]">
        <span className={t.pulse ? "inline-flex animate-pulse" : "inline-flex"}>
          <CloudGlyph size={14} color={t.color} />
        </span>
        <span className="text-foreground">On your machine: {t.label}</span>
        <div className="ml-auto flex gap-1.5">
          {item ? (
            <button type="button" onClick={() => void actions.pull(threadId, item)} className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-foreground hover:border-[color:var(--attention)]">
              Pull results
            </button>
          ) : null}
          {item?.url ? (
            <button type="button" onClick={() => open(item.url)} className="rounded-md border border-border px-2 py-0.5 text-[11.5px] text-foreground hover:border-[color:var(--attention)]">
              Open there
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!data ? (
          <div className="text-[12px] text-muted-foreground">Reading your always-on machine…</div>
        ) : data.error ? (
          <div className="text-[12px] text-destructive">{data.error}</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-foreground/90">{data.log.trim() || "Nothing yet."}</pre>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="Tell your machine something (⌘↵ to send)"
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[12.5px] text-foreground outline-none focus:border-[color:var(--attention)]"
        />
        <div className="mt-1.5 flex justify-end">
          <button type="button" disabled={sending || !text.trim()} onClick={send} className="rounded-md bg-foreground px-3 py-1 text-[12px] font-medium text-background disabled:opacity-40">
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
