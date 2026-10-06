// Home or away, for the chip on the new-thread screen. Only when the member has set up
// storage at home: a quick TCP check on an address that only answers on the home
// network says where they are, and an SSH ping says whether the always-on machine answers.
import { execFile } from "node:child_process";
import net from "node:net";
import { z } from "zod";
import { profile } from "./server-profile";

const BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin";

export const whereSchema = z.object({
  /** false when no storage at home is set up: the chip hides and new work starts in the usual project. */
  enabled: z.boolean(),
  mode: z.enum(["home", "away"]),
  machine: z.boolean(),
  machineLabel: z.string(),
  storageLabel: z.string(),
  homeProject: z.string(),
  awayProject: z.string(),
});
export type Where = z.infer<typeof whereSchema>;

export function run(cmd: string, args: string[], opts: { timeout?: number; input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { env: { ...process.env, PATH: BASE_PATH }, timeout: opts.timeout ?? 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split("\n").slice(-2).join(" ")));
      else resolve(stdout);
    });
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

function answers(hostPort: string, timeout = 1500): Promise<boolean> {
  const i = hostPort.lastIndexOf(":");
  const host = i > 0 ? hostPort.slice(0, i) : hostPort;
  const port = i > 0 ? Number(hostPort.slice(i + 1)) || 445 : 445;
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

/** SSH to the always-on machine answers within a few seconds. */
export const machineAnswers = (host: string) =>
  run("/usr/bin/ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", host, "true"], { timeout: 12_000 }).then(() => true, () => false);

let cached: { at: number; key: string; value: Where } | null = null;

/** Home or away (cached a minute). Shared by everything that must not touch home storage when away. */
export async function whereNow(): Promise<Where> {
  const p = profile();
  const key = JSON.stringify([p.storage, p.machine]);
  if (cached && cached.key === key && Date.now() - cached.at < 60_000) return cached.value;
  const base = {
    machineLabel: p.machine?.label ?? "",
    storageLabel: p.storage?.label ?? "",
    homeProject: p.storage?.homeProject ?? "",
    awayProject: p.storage?.awayProject ?? "",
  };
  let value: Where;
  if (!p.storage) {
    value = { enabled: false, mode: "home", machine: false, ...base };
  } else {
    const [home, machine] = await Promise.all([p.storage.homeCheck ? answers(p.storage.homeCheck) : Promise.resolve(true), p.machine ? machineAnswers(p.machine.sshHost) : Promise.resolve(false)]);
    value = { enabled: true, mode: home ? "home" : "away", machine, ...base };
  }
  cached = { at: Date.now(), key, value };
  return value;
}

export function createWhere() {
  return { where: whereNow };
}
