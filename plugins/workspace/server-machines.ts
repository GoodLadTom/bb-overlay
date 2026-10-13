// The always-on machine as a second machine of THIS bb server (enrolled in bb under
// Settings, Machines, with the same name you gave it in Set up). Unlike "Send to my
// always-on machine" (server-machine.ts), which hands a brief to that machine's own
// separate bb, threads started here run on the always-on machine but stay in this bb:
// same sidebar, same history, same server.
//
// A project runs there only through a project source on that machine (a checkout
// path). We look it up, and can add one where the project usually lives there:
// storage at home at the same path on both machines, anything under your home folder
// at the same place under the other machine's home folder.
//
// Nothing here is configured by hand: the machine's name comes from the profile, its
// home folder is read once over SSH, and every control hides while no machine is set up.
import os from "node:os";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { profile } from "./server-profile";
import { run } from "./server-where";

export const hostMachineSchema = z.object({
  /** The machine's host id in this bb, or null when none matches the always-on machine's name. */
  hostId: z.string().nullable(),
  connected: z.boolean(),
  /** The always-on machine's name from Set up ("" when none is set up). */
  label: z.string(),
  /** The project's checkout on that machine, when it has one. */
  sourcePath: z.string().nullable(),
  /** Where the project probably lives there, when it has no checkout there yet. */
  suggestedPath: z.string().nullable(),
  /** The project's checkout on this computer (the server machine), to switch back. */
  localHostId: z.string().nullable(),
  localPath: z.string().nullable(),
});
export type HostMachine = z.infer<typeof hostMachineSchema>;

type Host = { id: string; name: string; status: string; type: string; machineProviderId: string | null };
type Source = { id: string; hostId: string; path: string; isDefault: boolean };

const LOCAL_HOME = os.homedir().replace(/\/$/, "") + "/";
const trim = (p: string) => p.replace(/\/+$/, "");

/** Storage at home: mounted at the same path on this computer and on the always-on machine. */
const sharedRoot = () => {
  const p = profile().storage?.path?.trim();
  return p ? trim(p.replace(/^~(?=\/|$)/, os.homedir())) : null;
};
export const isShared = (p: string) => {
  const root = sharedRoot();
  return !!root && (p === root || p.startsWith(`${root}/`));
};

let remoteHome: { host: string; value: string | null } | null = null;
/** The always-on machine's home folder, read once over SSH (null when it can't be reached). */
async function homeThere(): Promise<string | null> {
  const host = profile().machine?.sshHost ?? "";
  if (!host) return null;
  if (remoteHome && remoteHome.host === host && remoteHome.value) return remoteHome.value;
  const value = await run("/usr/bin/ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, 'printf %s "$HOME"'], { timeout: 15_000 })
    .then((out) => (out.trim().startsWith("/") ? trim(out.trim()) + "/" : null))
    .catch(() => null);
  remoteHome = { host, value };
  return value;
}

/** Where a path on this computer usually lives on the always-on machine. */
export async function remotePathFor(localPath: string): Promise<string> {
  if (isShared(localPath)) return localPath;
  const there = await homeThere();
  if (there && localPath.startsWith(LOCAL_HOME)) return there + localPath.slice(LOCAL_HOME.length);
  return localPath;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms))]);

export function createMachines(bb: BbPluginApi) {
  let cache: { at: number; key: string; host: Host | null } | null = null;
  const label = () => profile().machine?.label?.trim() ?? "";

  /** The bb machine whose name matches the always-on machine's name (or its SSH host). */
  async function machineHost(): Promise<Host | null> {
    const m = profile().machine;
    if (!m) return null;
    const names = [m.label, m.sshHost].map((x) => x.trim().toLowerCase()).filter(Boolean);
    const key = names.join("|");
    if (cache && cache.key === key && Date.now() - cache.at < 15_000) return cache.host;
    const hosts = (await bb.sdk.hosts.list({ type: "persistent" })) as unknown as Host[];
    const host = hosts.find((h) => names.includes(h.name.trim().toLowerCase())) ?? null;
    cache = { at: Date.now(), key, host };
    return host;
  }

  async function sources(projectId: string): Promise<Source[]> {
    const p = (await bb.sdk.projects.get({ projectId })) as unknown as { sources?: Source[] };
    return p.sources ?? [];
  }

  async function forProject(projectId: string | null): Promise<HostMachine> {
    const host = await machineHost().catch(() => null);
    const out: HostMachine = {
      hostId: host?.id ?? null,
      connected: host?.status === "connected",
      label: label(),
      sourcePath: null,
      suggestedPath: null,
      localHostId: null,
      localPath: null,
    };
    if (!projectId || !host) return out;
    const all = await sources(projectId).catch(() => [] as Source[]);
    const local = all.filter((s) => s.hostId !== host.id);
    const localSrc = local.find((s) => s.isDefault) ?? local[0];
    out.localHostId = localSrc?.hostId ?? null;
    out.localPath = localSrc?.path ?? null;
    const there = all.find((s) => s.hostId === host.id);
    out.sourcePath = there?.path ?? null;
    if (!there && localSrc) out.suggestedPath = await remotePathFor(localSrc.path);
    return out;
  }

  /** Give the project a checkout on the always-on machine at the suggested path, after checking the path is there. */
  async function link(projectId: string): Promise<HostMachine> {
    const state = await forProject(projectId);
    const name = state.label || "your always-on machine";
    if (!state.hostId) throw new Error(`No machine named "${name}" is enrolled in this bb. Add it in bb under Settings, Machines, with the same name as in Set up.`);
    if (!state.connected) throw new Error(`${name} is not connected right now.`);
    if (state.sourcePath) return state;
    const target = state.suggestedPath;
    if (!target) throw new Error(`This project has no folder on this computer to match on ${name}.`);
    const seen = await withTimeout(bb.sdk.hosts.pathsExist({ hostId: state.hostId, paths: [target] }), 20_000, `Checking the folder on ${name}`).catch((e: unknown) => {
      throw new Error(
        `${e instanceof Error ? e.message : String(e)}. If the folder is on network storage, ${name} must let bb read network volumes (on a Mac: System Settings, Privacy & Security, Files & Folders).`,
      );
    });
    if (!seen.existence[target]) throw new Error(`${target} is not on ${name}. Clone or copy the project there first.`);
    await bb.sdk.projects.sources.add({ projectId, type: "local_path", hostId: state.hostId, path: target });
    bb.log.info(`always-on machine: added source ${target} for ${projectId}`);
    return forProject(projectId);
  }

  return { machineHost, forProject, link };
}
