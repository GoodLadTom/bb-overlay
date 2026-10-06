// Control room: one strip across every harness on bb's home screen.
import { useMemo } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, type PluginHomepageSectionProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { GOLD, GOLD_INK, Lattice, Legend, Node, ago, caps, harnessOf, stateOf, tnum, type Harness, type State } from "./shared";

function Stat({ label, value, tone, note }: { label: string; value: number; tone?: "gold" | "bad"; note?: string }) {
  const color = tone === "gold" ? GOLD_INK : tone === "bad" ? "var(--destructive-text)" : undefined;
  return (
    <div className="min-w-0 border-t border-border pt-3">
      <div className={cn(caps, "flex items-center gap-2")}>{label}{label === "Running" && value > 0 ? <Lattice cell={2.5} gap={1.5} /> : null}</div>
      <div className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.02em]" style={{ ...tnum, color }}>
        {value}
      </div>
      {note ? <div className="mt-1.5 truncate text-[12px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}

function SplitBar({ parts, total, max }: { parts: Array<{ n: number; color: string; label: string }>; total: number; max: number }) {
  return (
    <div className="flex h-2.5 overflow-hidden rounded-[3px] bg-muted" style={{ width: `${Math.max(6, (total / Math.max(1, max)) * 100)}%` }}>
      {parts.map((p) =>
        p.n > 0 ? <div key={p.label} title={`${p.label}: ${p.n}`} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} /> : null,
      )}
    </div>
  );
}

export function ControlRoom(_props: PluginHomepageSectionProps) {
  const { status, threads } = useSidebarThreads();
  const now = Date.now();
  const model = useMemo(() => {
    const live = threads.filter((t) => !t.isHidden && !t.isArchived);
    const tally = { running: 0, needs: 0, unread: 0, parked: 0 } as Record<State, number>;
    const perHarness = new Map<string, { h: Harness; s: Record<State, number>; total: number }>();
    for (const t of live) {
      const s = stateOf(t);
      tally[s] += 1;
      const h = harnessOf(t.providerId);
      const row = perHarness.get(h.key) ?? { h, s: { running: 0, needs: 0, unread: 0, parked: 0 }, total: 0 };
      row.s[s] += 1;
      row.total += 1;
      perHarness.set(h.key, row);
    }
    const rows = [...perHarness.values()].sort((a, b) => b.total - a.total);
    const needs = live.filter((t) => stateOf(t) === "needs").sort((a, b) => b.updatedAt - a.updatedAt);
    return { live, tally, rows, needs, max: Math.max(1, ...rows.map((r) => r.total)) };
  }, [threads]);

  if (status !== "ready" && threads.length === 0) return null;

  return (
    <div className="w-full">
      <p className={cn(caps, "mb-1 text-right")}>Every harness · live</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="Running" value={model.tally.running} tone="gold" note="working right now" />
        <Stat label="Needs you" value={model.tally.needs} tone={model.tally.needs > 0 ? "bad" : undefined} note="errors, questions, approvals" />
        <Stat label="Unread" value={model.tally.unread} note="finished, not yet read" />
        <Stat label="Parked" value={model.tally.parked} note="context intact" />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1.1fr_1fr]">
        <div className="border-t border-border pt-3">
          <div className={cn(caps, "mb-3")}>By harness</div>
          <div className="space-y-2.5">
            {model.rows.map((r) => (
              <div key={r.h.key} className="grid grid-cols-[72px_1fr_28px] items-center gap-3 text-[13px]">
                <span className="truncate text-foreground">{r.h.label}</span>
                <SplitBar
                  total={r.total}
                  max={model.max}
                  parts={[
                    { n: r.s.running, color: GOLD, label: "Running" },
                    { n: r.s.needs, color: "var(--destructive)", label: "Needs you" },
                    { n: r.s.unread, color: "var(--foreground)", label: "Unread" },
                    { n: r.s.parked, color: "var(--input)", label: "Parked" },
                  ]}
                />
                <span className="text-right text-[12px] text-muted-foreground" style={tnum}>
                  {r.total}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <Legend color={GOLD} label="Running" />
            <Legend color="var(--destructive)" label="Needs you" />
            <Legend color="var(--foreground)" label="Unread" />
            <Legend color="var(--input)" label="Parked" />
          </div>
        </div>
        <div className="border-t border-border pt-3">
          <div className={cn(caps, "mb-2 flex justify-between")}>
            <span>Needs you</span>
            <span style={tnum}>{model.needs.length}</span>
          </div>
          {model.needs.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing is waiting on you.</p>
          ) : (
            <ul>
              {model.needs.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <a href={t.href} className="flex h-8 items-center gap-2.5 text-[13px] text-foreground no-underline hover:underline">
                    <Node state="needs" />
                    <span className="min-w-0 flex-1 truncate">{t.displayTitle}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{harnessOf(t.providerId).label}</span>
                    <span className="w-6 text-right text-[11px] text-muted-foreground" style={tnum}>
                      {ago(t.updatedAt, now)}
                    </span>
                  </a>
                </li>
              ))}
              {model.needs.length > 5 ? <li className="pt-1 text-[12px] text-muted-foreground">and {model.needs.length - 5} more in the rail</li> : null}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}


