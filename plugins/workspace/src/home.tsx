// Home: the NavAIgate front page inside bb.
//   Hero        logo orb, greeting, today's brief (run on demand, not on a timer)
//   Ask         one box that starts a real bb chat; on Auto, Jev routes it to a harness
//   Inbox       mail that needs a reply, triaged by Jev (src/inbox.tsx)
//   Plans       an orb per subscription (Claude, Codex, Cursor) + plan advice
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSpawn, useWorkProject } from "./spawn";
import { SetupWizard, useGreeting, useProfile } from "./onboarding";
import {
  experimental_ProviderIcon as BbProviderIcon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { rpcContract } from "../server";
import type { HomeAccount } from "../server-home";
import { InboxCard } from "./inbox";
import { SocialCard } from "./social";
import { AudienceRow } from "./audience";
import { HarnessOrb, LogoOrb } from "./orb";
import { GOLD, caps, harnessOf, stateOf, tnum } from "./shared";


const PROVIDER: Record<string, string> = { claude: "claude-code", codex: "codex", cursor: "acp-cursor" };

/** The harness logo from bb's own provider records (id-only records fall back to a generic glyph). */
function ProviderIcon({ id, className }: { id: string; className?: string }) {
  const { providers } = useProviders();
  const rec = providers.find((p) => p.id === id) as { id: string; logoUrl?: string | null } | undefined;
  return <BbProviderIcon providerKind="agent" provider={rec ?? { id }} className={className} />;
}
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n)}%`);
function resets(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `resets in ${h}h` : `resets in ${Math.round(h / 24)} days`;
}
/** The chat behind "Run today's brief": writes one HTML file that the Brief line on Home reads. */
function briefPrompt(): string {
  const day = new Date().toISOString().slice(0, 10);
  return [
    `Write my daily brief for ${day} and save it as ~/Documents/Daily_Brief/${day}.html (create the folder if needed).`,
    "",
    "Use a simple, readable HTML page with one <h2> per section and a <ul> of short <li> items under each, in this order:",
    "1. Today: my calendar for today and tomorrow (Google Calendar through Composio, if connected).",
    "2. Needs a reply: emails from people that ask me something, newest and most urgent first (Gmail through Composio, read-only).",
    "3. Open to-dos: my open bb Tasks (use the `bb tasks` command), most important first.",
    "4. Agents: bb threads that are running, need me, or finished unread (run `bb thread list --json`).",
    "",
    "Skip a section with a one-line note if its tool isn't connected. Read only: never send, label, archive or change anything. When the file is saved, reply with the three things I should do first.",
  ].join("\n");
}

function usePoll<T>(fn: () => Promise<T>, ms: number): [T | null, () => void] {
  const [v, setV] = useState<T | null>(null);
  const run = useCallback(() => {
    fn().then(setV, () => {});
  }, [fn]);
  useEffect(() => {
    run();
    const id = window.setInterval(() => document.visibilityState === "visible" && run(), ms);
    return () => window.clearInterval(id);
  }, [run, ms]);
  return [v, run];
}

/* ------------------------------- Ask -------------------------------- */

type Who = "claude" | "codex" | "cursor";
type Route = {
  decisionId: string;
  source: "chip" | "text" | "jev" | "fallback";
  harness: Who;
  odds: Record<Who, number> | null;
  confidence: number | null;
  effort: "low" | "medium" | "high" | null;
  autoStart: boolean;
  message: string;
};
type AskLog = {
  recent: Array<{ id: string; at: number; text: string; source: string; suggested: Who; chosen: Who | null; confidence: number | null }>;
  jevDecisions: number;
  overrides: number;
};
const WHO_LABEL: Record<Who, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" };

function Ask() {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const { projects } = useSidebarThreads();
  const { providers, status } = useProviders();
  const [text, setText] = useState("");
  const [pick, setPick] = useState<"auto" | Who>("auto");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ route: Route; prompt: string } | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const project = useWorkProject();
  const logFn = useCallback(() => rpc.call("ask_log") as Promise<AskLog>, [rpc]);
  const [log, reloadLog] = usePoll(logFn, 5 * 60_000);

  const rec = (h: Who) => providers.find((p) => p.id === PROVIDER[h]) as { available?: boolean; reasoningLevels?: Array<{ id: string }> } | undefined;
  // Unknown while loading counts as available; a provider bb reports as unavailable gets zero odds.
  const available = (h: Who) => status !== "ready" || (rec(h)?.available ?? false);

  const start = async (route: Route, harness: Who, prompt: string) => {
    if (!project) return;
    setBusy(true);
    try {
      const levels = rec(harness)?.reasoningLevels?.map((l) => l.id) ?? [];
      const reasoningLevel = route.source === "jev" && route.effort && levels.includes(route.effort) ? route.effort : undefined;
      const made = await sdk.threads.spawn({
        projectId: project.id,
        environment: { type: "project-default" },
        providerId: PROVIDER[harness],
        title: prompt.slice(0, 80),
        visibility: "visible",
        prompt,
        ...(reasoningLevel ? { reasoningLevel } : {}),
      } as Parameters<typeof sdk.threads.spawn>[0]);
      await rpc.call("ask_commit", { decisionId: route.decisionId, harness }).catch(() => {});
      setText("");
      setConfirm(null);
      reloadLog();
      nav.toThread((made as { id: string }).id);
    } catch (e) {
      toast.error("Could not start the chat", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const go = async () => {
    const prompt = text.trim();
    if (!prompt || busy || !project) return;
    setBusy(true);
    setConfirm(null);
    let route: Route;
    try {
      route = (await rpc.call("ask_route", { text: prompt, pick, available: { claude: available("claude"), codex: available("codex"), cursor: available("cursor") } })) as Route;
    } catch (e) {
      setBusy(false);
      toast.error("Could not route the request", { description: e instanceof Error ? e.message : String(e) });
      return;
    }
    setBusy(false);
    reloadLog();
    setLine(route.autoStart ? route.message : null);
    if (route.autoStart) await start(route, route.harness, prompt);
    else setConfirm({ route, prompt });
  };

  const ranked = confirm?.route.odds ? (Object.entries(confirm.route.odds) as Array<[Who, number]>).sort((a, b) => b[1] - a[1]) : [];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={caps}>Ask</span>
        <span className="text-[12px] text-muted-foreground">Starts a real chat in {project?.name ?? "your project"}. On Auto, Jev picks the harness.</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void go();
        }}
        rows={3}
        placeholder="For example: check which pages on my website still use the old logo and list them"
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-[color:var(--attention)]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(["auto", "claude", "codex", "cursor"] as const).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setPick(h)}
            disabled={h !== "auto" && !available(h)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-40",
              pick === h ? "border-[color:var(--attention)] text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {h === "auto" ? <span className="text-[11px]" style={{ color: GOLD }}>◆</span> : <ProviderIcon id={PROVIDER[h]} className="size-3.5" />}
            {h === "auto" ? "Auto" : harnessOf(PROVIDER[h]).label}
          </button>
        ))}
        <button
          type="button"
          disabled={!text.trim() || busy}
          onClick={() => void go()}
          className="ml-auto rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-[#202225] disabled:opacity-40"
          style={{ background: GOLD }}
        >
          {busy ? "Starting…" : "Start ⌘↵"}
        </button>
      </div>
      {confirm ? (
        <div className="mt-3 rounded-lg border border-[color:var(--attention)] px-3 py-2.5">
          <div className="text-[12.5px] text-foreground" style={tnum}>
            Start this on {WHO_LABEL[confirm.route.harness]}?{" "}
            <span className="text-muted-foreground">
              {ranked.map(([h, o]) => `${h === confirm.route.harness ? "" : `${WHO_LABEL[h]} `}${o.toFixed(2)}`).join(" · ")}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["claude", "codex", "cursor"] as const)
              .filter(available)
              .map((h) => (
                <button
                  key={h}
                  type="button"
                  disabled={busy}
                  onClick={() => void start(confirm.route, h, confirm.prompt)}
                  className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]", h === confirm.route.harness ? "border-[color:var(--attention)] text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                >
                  <ProviderIcon id={PROVIDER[h]} className="size-3.5" />
                  {WHO_LABEL[h]}
                </button>
              ))}
            <button type="button" onClick={() => setConfirm(null)} className="ml-auto px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {line ? <div className="mt-2 text-[11.5px] text-muted-foreground" style={tnum}>{line}</div> : null}
      {log && log.recent.length ? (
        <div className="mt-3 border-t border-border pt-2">
          <div className="mb-1 flex items-baseline gap-2">
            <span className={caps}>Recent routing</span>
            <span className="ml-auto text-[11px] text-muted-foreground" style={tnum}>
              Overrode Jev {log.overrides} of {log.jevDecisions}
            </span>
          </div>
          {log.recent.map((e) => (
            <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-0.5 text-[11.5px]">
              <span className="truncate text-foreground/85">{e.text}</span>
              <span className="text-muted-foreground" style={tnum}>
                {e.chosen ? WHO_LABEL[e.chosen] : "not started"} · {e.source === "jev" ? `Jev ${e.confidence?.toFixed(2) ?? ""}${e.chosen && e.chosen !== e.suggested ? " · overridden" : ""}` : e.source}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------ Plans ------------------------------- */

function Plans({ accounts, workingBy }: { accounts: HomeAccount[] | null; workingBy: Set<string> }) {
  const [mode, setMode] = useState<"orb" | "bar">(() => (localStorage.getItem("nav-skin:orbmode") as "orb" | "bar") ?? "orb");
  useEffect(() => localStorage.setItem("nav-skin:orbmode", mode), [mode]);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={caps}>Subscriptions</span>
        <span className="text-[12px] text-muted-foreground">Fill is this week (this month for Cursor), the gold ring is the current session.</span>
        <div className="ml-auto flex rounded-md border border-border p-0.5 text-[11.5px]">
          {(["orb", "bar"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn("rounded px-2 py-0.5", mode === m ? "bg-background text-foreground" : "text-muted-foreground")}>
              {m === "orb" ? "Orb" : "Bar"}
            </button>
          ))}
        </div>
      </div>
      {!accounts ? (
        <div className="py-6 text-[12px] text-muted-foreground">Reading your subscriptions…</div>
      ) : (
        <div className={cn("grid gap-4", mode === "orb" ? "grid-cols-[repeat(auto-fill,minmax(190px,1fr))]" : "grid-cols-1")}>
          {accounts.map((a) => {
            const working = workingBy.has(a.harness);
            const who = a.email ? a.email.split("@")[0] : "";
            return mode === "orb" ? (
              <div key={a.id} className="flex flex-col items-center text-center">
                <HarnessOrb
                  harness={a.harness}
                  cycle={a.week}
                  session={a.session}
                  working={working}
                  icon={<ProviderIcon id={PROVIDER[a.harness]} className="size-7" />}
                />
                <div className="mt-3 text-[13px] font-semibold text-foreground">{a.plan ?? a.label}</div>
                <div className="truncate text-[11.5px] text-muted-foreground" title={a.email ?? ""}>
                  {who}
                </div>
                <div className="mt-1 text-[12px] text-foreground" style={tnum}>
                  {a.cycleLabel} {pct(a.week)}
                  {a.session !== null ? <span className="text-muted-foreground"> · session {pct(a.session)}</span> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">{a.status === "error" ? "Could not read usage" : resets(a.weekResetsAt)}</div>
                {a.advice ? <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">{a.advice}</p> : null}
              </div>
            ) : (
              <div key={a.id} className="grid grid-cols-[150px_1fr_auto] items-center gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">{a.plan ?? a.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{who}</div>
                </div>
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, a.week ?? 0)}%`, background: (a.week ?? 0) >= 85 ? "#E8796A" : GOLD }} />
                  </div>
                  {a.advice ? <div className="mt-1 text-[11px] text-muted-foreground">{a.advice}</div> : null}
                </div>
                <div className="text-right text-[12px] text-foreground" style={tnum}>
                  {pct(a.week)}
                  <div className="text-[10.5px] text-muted-foreground">{resets(a.weekResetsAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------ Agenda ------------------------------ */

type Agenda = {
  configured: boolean;
  error: string | null;
  reconnect: string[];
  events: Array<{ title: string; start: string; end: string | null; allDay: boolean; account: string; location: string | null; link: string | null }>;
};

function AgendaCard({ agenda }: { agenda: Agenda | null }) {
  const now = Date.now();
  const dayKey = (iso: string) => (iso.length <= 10 ? iso : new Date(iso).toLocaleDateString("en-CA"));
  const todayKey = new Date().toLocaleDateString("en-CA");
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const groups = new Map<string, Agenda["events"]>();
  for (const e of agenda?.events ?? []) {
    const k = dayKey(e.start);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className={cn(caps, "mb-3")}>Agenda</div>
      {!agenda ? (
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      ) : !agenda.configured ? (
        <div className="text-[12.5px] text-muted-foreground">Calendar comes through Composio. Add your Composio key in Set up (in the sidebar).</div>
      ) : agenda.error ? (
        <div className="text-[12.5px] text-destructive">{agenda.error}</div>
      ) : (
        <>
          {agenda.reconnect.length ? (
            <div className="mb-2 rounded-md border border-[color:var(--attention)] px-3 py-2 text-[12px] text-foreground">
              Google Calendar needs signing in again for {agenda.reconnect.join(", ")}. Ask in any chat to "reconnect my calendar".
            </div>
          ) : null}
          {groups.size === 0 ? (
            <div className="text-[12.5px] text-muted-foreground">{agenda.reconnect.length ? "" : "Nothing on today or tomorrow."}</div>
          ) : (
            Array.from(groups.entries()).map(([day, evs]) => (
              <div key={day} className="mb-2">
                <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">{day === todayKey ? "Today" : "Tomorrow"}</div>
                {evs.map((e, i) => {
                  const live = !e.allDay && new Date(e.start).getTime() <= now && (!e.end || new Date(e.end).getTime() > now);
                  return (
                    <div key={i} className="grid grid-cols-[92px_1fr_auto] items-baseline gap-3 py-1 text-[12.5px]">
                      <span className="text-muted-foreground" style={tnum}>
                        {e.allDay ? "All day" : `${time(e.start)}${e.end ? `–${time(e.end)}` : ""}`}
                      </span>
                      <span className="truncate text-foreground" style={live ? { color: GOLD } : undefined}>
                        {live ? "Now · " : ""}
                        {e.title}
                      </span>
                      {e.link ? (
                        <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-muted-foreground hover:text-foreground">
                          Open
                        </a>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------- Page ------------------------------- */

export function HomePage() {
  const rpc = useRpc<typeof rpcContract>();
  const { threads } = useSidebarThreads();
  const accountsFn = useCallback(() => rpc.call("home_accounts").then((r) => r.accounts), [rpc]);
  const briefFn = useCallback(() => rpc.call("home_brief"), [rpc]);
  const agendaFn = useCallback(() => rpc.call("home_agenda") as Promise<Agenda>, [rpc]);
  const [agenda] = usePoll(agendaFn, 5 * 60_000);
  const [accounts] = usePoll(accountsFn, 90_000);
  const [brief, reloadBrief] = usePoll(briefFn, 5 * 60_000);
  const [running, setRunning] = useState(false);
  const { profile } = useProfile();
  const hello = useGreeting();
  const { spawn } = useSpawn();

  const workingBy = useMemo(() => {
    const s = new Set<string>();
    for (const t of threads) if (stateOf(t) === "running") s.add(harnessOf(t.providerId).key);
    return s;
  }, [threads]);
  const working = threads.filter((t) => stateOf(t) === "running").length;

  const runBrief = async () => {
    setRunning(true);
    try {
      const started = await spawn("brief", `Daily brief ${new Date().toISOString().slice(0, 10)}`, briefPrompt());
      if (started) window.setTimeout(reloadBrief, 3 * 60_000);
    } finally {
      setRunning(false);
    }
  };

  if (profile && !profile.onboarded) return <SetupWizard />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-4 px-6 py-6">
        <section className="flex items-center gap-6 rounded-xl border border-border bg-card px-6 py-5">
          <LogoOrb size={120} mood={working ? "busy" : "idle"} />
          <div className="min-w-0 flex-1">
            <div className={caps}>NavAIgate</div>
            <h1 className="mt-1 text-[26px] font-semibold leading-tight text-foreground">{hello}</h1>
            <div className="mt-1 text-[13px] text-muted-foreground">
              {working ? `${working} agent${working === 1 ? "" : "s"} working right now.` : "Nothing running right now."}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className={caps}>Brief</span>
              <span className="min-w-0 flex-1 truncate text-foreground/85">{brief?.headline ?? "No brief yet."}</span>
              {brief?.date ? <span className="text-muted-foreground" style={tnum}>{brief.date}</span> : null}
              <button type="button" disabled={running} onClick={() => void runBrief()} className="rounded-md border border-border px-2.5 py-1 text-[12px] text-foreground hover:border-[color:var(--attention)] disabled:opacity-50">
                {running ? "Starting…" : "Run today's brief"}
              </button>
            </div>
          </div>
        </section>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Ask />
          <AgendaCard agenda={agenda} />
        </div>
        <InboxCard />
        <SocialCard />
        <AudienceRow />
        <Plans accounts={accounts} workingBy={workingBy} />
      </div>
    </div>
  );
}
