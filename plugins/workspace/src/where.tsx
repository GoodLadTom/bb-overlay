// Where the member is (home: storage direct; away: storage through the always-on machine)
// and which bb project to start a new chat in: the chip under the greeting on the
// new-thread screen. Hidden unless storage at home is set up.
import { useEffect, useState } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { GOLD } from "./shared";
import type { rpcContract } from "../server";
import type { Where } from "../server-where";

export function useWhere() {
  const rpc = useRpc<typeof rpcContract>();
  const [where, setWhere] = useState<Where | null>(null);
  const [tick, setTick] = useState(0);
  useRealtime("profile", () => setTick((n) => n + 1));
  useEffect(() => {
    let live = true;
    const load = () => rpc.call("where_now").then((w) => live && setWhere(w), () => undefined);
    load();
    const t = window.setInterval(load, 120_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [rpc, tick]);
  return where;
}

/** The bb projects for work on storage: on the share (home) and on the local copy (away). */
export function useStorageProjects(where: Where | null) {
  const { projects } = useSidebarThreads();
  const find = (name: string) => (name ? projects.find((p) => p.name === name)?.id ?? null : null);
  return { home: find(where?.homeProject ?? ""), away: find(where?.awayProject ?? "") };
}

export function WhereBadge({ where }: { where: Where | null }) {
  if (!where) return <span className="text-[11.5px] text-muted-foreground">Checking where you are…</span>;
  const away = where.mode === "away";
  const storage = where.storageLabel || "storage";
  const machine = where.machineLabel || "always-on machine";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ background: away ? GOLD : "var(--success)" }} />
      {away ? (where.machine ? `Away · ${storage} through the ${machine}` : `Away · ${machine} not reachable`) : `Home · ${storage} direct`}
    </span>
  );
}

/** Under the greeting: where you are, and the project to start in (highlighted). */
export function WhereChip() {
  const where = useWhere();
  const projects = useStorageProjects(where);
  const nav = useBbNavigate();
  if (!where?.enabled || (!projects.home && !projects.away)) return null;
  const away = where.mode === "away";
  const pill = (label: string, id: string | null, recommended: boolean) =>
    id ? (
      <button
        type="button"
        onClick={() => nav.toProject(id)}
        className={cn("rounded-full border px-3 py-1 text-[12px]", recommended ? "font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
        style={recommended ? { borderColor: GOLD } : undefined}
        title={recommended ? "Recommended for where you are" : undefined}
      >
        {label}
      </button>
    ) : null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
      <WhereBadge where={where} />
      {pill(where.homeProject, projects.home, !away)}
      {pill(where.awayProject, projects.away, away)}
    </div>
  );
}
