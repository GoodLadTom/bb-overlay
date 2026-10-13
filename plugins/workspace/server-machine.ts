// The always-on machine (home Mac, mini PC or VPS running its own bb): which chats were
// handed over to it, and how they are doing there. `always-on send` (skills/always-on)
// records <laptop thread> -> <remote thread> in ~/.config/navaigate-workspace/handoffs.json.
// We watch that file and poll the machine's bb over SSH for each handed-over thread.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CONFIG_DIR, profile } from "./server-profile";

export const machineItemSchema = z.object({
  remoteThread: z.string(),
  url: z.string(),
  title: z.string(),
  provider: z.string(),
  sentAt: z.number(),
  /** The remote thread's bb status (active, idle, error, ...) or "unknown" while the machine can't be reached. */
  status: z.string(),
  updatedAt: z.number().nullable(),
});
export const machineStateSchema = z.object({
  /** false when no always-on machine is set up: the sidebar hides every hand-off control. */
  configured: z.boolean(),
  label: z.string(),
  /** null until the first poll; false when SSH to the machine failed last time. */
  reachable: z.boolean().nullable(),
  items: z.record(z.string(), machineItemSchema),
});
export type MachineState = z.infer<typeof machineStateSchema>;

const FILE = path.join(CONFIG_DIR, "handoffs.json");
const POLL_MS = 30_000;
const REMOTE_ENV =
  'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export NVM_DIR="$HOME/.nvm"; ' +
  '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null; ' +
  'BB="$(command -v bb || echo /Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb)"; ';

type Handoff = { remoteThread: string; url: string; title: string; provider: string; sentAt: number };

const host = () => profile().machine?.sshHost ?? "";
const label = () => profile().machine?.label || "always-on machine";

function readHandoffs(): Record<string, Handoff> {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, Partial<Handoff>>;
    const out: Record<string, Handoff> = {};
    for (const [local, h] of Object.entries(raw)) {
      if (h && typeof h.remoteThread === "string") {
        out[local] = { remoteThread: h.remoteThread, url: h.url ?? "", title: h.title ?? "", provider: h.provider ?? "", sentAt: Number(h.sentAt) || 0 };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function ssh(cmd: string, timeout = 25_000, signal?: AbortSignal): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    if (!host()) return resolve({ ok: false, stdout: "" });
    // The signal kills ssh when the plugin reloads, so the status service stops at once.
    execFile("/usr/bin/ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host(), REMOTE_ENV + cmd], { timeout, maxBuffer: 8 * 1024 * 1024, signal }, (err, stdout) =>
      resolve({ ok: !err, stdout: stdout ?? "" }),
    );
  });
}

async function remoteThreads(signal?: AbortSignal): Promise<Map<string, { status: string; updatedAt: number | null }> | null> {
  const r = await ssh("$BB thread list --json", 25_000, signal);
  if (!r.ok) return null;
  try {
    const d = JSON.parse(r.stdout) as Array<{ id: string; status?: string; updatedAt?: number }> | { threads?: Array<{ id: string; status?: string; updatedAt?: number }> };
    const list = Array.isArray(d) ? d : d.threads ?? [];
    return new Map(list.map((t) => [t.id, { status: t.status ?? "unknown", updatedAt: t.updatedAt ?? null }]));
  } catch {
    return null;
  }
}

// ---- Handing a chat over: done here, not by the chat's own agent ----
// A chat bound to slow storage can't even start its agent from a hotel (thread/resume times
// out), so the plugin reads the conversation itself and sends the brief with `always-on send`.

/** The always-on script shipped in this plugin's skills folder (server runs from dist/). */
function scriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "skills", "always-on", "always-on"),
    path.join(here, "skills", "always-on", "always-on"),
    path.join(os.homedir(), ".claude", "skills", "always-on", "always-on"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

const BB_APP_BIN = "/Applications/bb.app/Contents/MacOS/bb";
const BB_CLI = "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb";
// The usual system folders first (a bb started from the Dock has a thin PATH), then the
// member's own PATH, so tools outside them (bb on Linux, for one) are still found.
const BASE_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin", ...(process.env.PATH ?? "").split(":")]
  .filter((d, i, all) => d && all.indexOf(d) === i)
  .join(":");
const MAX_FILE = 50 * 1024 * 1024;

export const machineHandoffInput = z.object({ threadId: z.string().min(1), title: z.string().max(200), providerId: z.string().max(60) });
export const machineHandoffOutput = z.object({ remoteThread: z.string(), url: z.string(), notes: z.array(z.string()) });

function run(cmd: string, args: string[], env: Record<string, string>, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, PATH: BASE_PATH, ...env }, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split("\n").slice(-3).join(" ")));
      else resolve(stdout);
    });
  });
}

const alwaysOn = (args: string[], env: Record<string, string> = {}, timeout = 120_000) => run("/bin/bash", [scriptPath(), ...args], env, timeout);

export async function transcript(threadId: string): Promise<string> {
  const args = ["thread", "log", threadId, "--format", "minimal", "--limit", "30"];
  const out = fs.existsSync(BB_CLI)
    ? await run(fs.existsSync(BB_APP_BIN) ? BB_APP_BIN : process.execPath, [BB_CLI, ...args], { ELECTRON_RUN_AS_NODE: "1" }, 60_000)
    : await run(process.env.BB_CLI || "bb", args, {}, 60_000);
  const max = 60_000;
  return out.length <= max ? out : `${out.slice(0, 8_000)}\n\n[... middle of the conversation trimmed ...]\n\n${out.slice(-50_000)}`;
}

/** Files the chat mentions that only exist on this laptop: copy them over and point the brief there. */
async function carryFiles(text: string, notes: string[]): Promise<string> {
  const home = os.homedir();
  const storage = profile().storage;
  const localCopy = storage ? storage.localCopy.replace(/^~(?=\/|$)/, home).replace(/\/$/, "") + "/" : null;
  const re = new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^\\s"'\`)<>\\]]+\\.[A-Za-z0-9]{2,5}`, "g");
  const found = [...new Set(text.match(re) ?? [])].filter(
    (p) => !(storage && p.startsWith(storage.path + "/")) && !p.startsWith(`${home}/Documents/GitHub/`) && !p.includes("/.claude/") && !p.includes("/.bb/"),
  );
  let out = text;
  for (const p of found.slice(0, 15)) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || st.size > MAX_FILE) continue;
      if (storage && localCopy && p.startsWith(localCopy)) {
        const res = await alwaysOn(["push", p]).catch((e: unknown) => `failed: ${String(e)}`);
        const stored = `${storage.path}/${p.slice(localCopy.length)}`;
        if (String(res).startsWith("failed")) notes.push(`Not pushed (the stored copy changed): ${p.slice(localCopy.length)}`);
        out = out.split(p).join(stored);
      } else {
        const res = await alwaysOn(["put", p]);
        const there = res.match(/on the .+?: (.+)/)?.[1]?.trim();
        if (there) {
          out = out.split(p).join(there);
          notes.push(`Copied over: ${path.basename(p)}`);
        }
      }
    } catch {
      /* missing or unreadable: the machine just won't have it */
    }
  }
  return out;
}

export async function handOff(input: z.infer<typeof machineHandoffInput>): Promise<z.infer<typeof machineHandoffOutput>> {
  if (!host()) throw new Error("No always-on machine set up yet. Add one in Set up workspace.");
  const notes: string[] = [];
  const convo = await carryFiles(await transcript(input.threadId), notes);
  const brief = [
    `# ${input.title || "Handed-over chat"}`,
    "",
    `This chat was started on the laptop and is being handed to the ${label()} part-way through.`,
    "Below is the conversation so far. Work out what was being done and what is still open, then carry on",
    "from exactly where it stopped. Act on the most recent clear request; don't redo finished steps.",
    "",
    "## Conversation so far",
    "",
    convo,
  ].join("\n");
  const file = path.join(os.tmpdir(), `always-on-handoff-${input.threadId}.md`);
  fs.writeFileSync(file, brief);
  const provider = ["claude-code", "codex", "acp-cursor", "pi"].includes(input.providerId) ? input.providerId : "claude-code";
  try {
    const out = await alwaysOn(["send", "--provider", provider, "--title", input.title.slice(0, 80) || "Handed-over chat", "-f", file], { BB_THREAD_ID: input.threadId }, 180_000);
    const remoteThread = out.match(/sent: (\S+)/)?.[1] ?? "";
    const url = out.match(/watch: (https?:\S+)/)?.[1] ?? "";
    if (!remoteThread) throw new Error(out.trim().split("\n").slice(-2).join(" "));
    return { remoteThread, url, notes };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// ---- Watching a handed-over chat from inside the laptop's chat ----

export const machineLogOutput = z.object({
  mapped: z.boolean(),
  remoteThread: z.string(),
  url: z.string(),
  log: z.string(),
  error: z.string().nullable(),
});

/** The remote side of a handed-over chat: its recent turns, as `bb thread log` prints them. */
export async function machineLog(threadId: string): Promise<z.infer<typeof machineLogOutput>> {
  const h = readHandoffs()[threadId];
  if (!h) return { mapped: false, remoteThread: "", url: "", log: "", error: null };
  const r = await ssh(`$BB thread log ${h.remoteThread} --format minimal --limit 6`);
  const log = r.stdout.length > 12_000 ? r.stdout.slice(-12_000) : r.stdout;
  return { mapped: true, remoteThread: h.remoteThread, url: h.url, log, error: !r.ok && !r.stdout ? `The ${label()} can't be reached right now.` : null };
}

/** Sends a follow-up to the remote chat. */
export async function machineTell(threadId: string, text: string): Promise<{ ok: boolean }> {
  const h = readHandoffs()[threadId];
  if (!h) throw new Error(`This chat hasn't been sent to the ${label()}.`);
  const file = path.join(os.tmpdir(), `always-on-tell-${threadId}.txt`);
  fs.writeFileSync(file, text);
  try {
    await alwaysOn(["tell", h.remoteThread, "-f", file]);
    return { ok: true };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export function createMachine(bb: BbPluginApi) {
  let state: MachineState = { configured: false, label: "", reachable: null, items: {} };
  let last = "";

  const refresh = async (signal?: AbortSignal) => {
    const handoffs = readHandoffs();
    const configured = !!host();
    const remote = configured && Object.keys(handoffs).length ? await remoteThreads(signal) : null;
    if (signal?.aborted) return state;
    const items: MachineState["items"] = {};
    for (const [local, h] of Object.entries(handoffs)) {
      const r = remote?.get(h.remoteThread);
      items[local] = { ...h, status: r?.status ?? "unknown", updatedAt: r?.updatedAt ?? null };
    }
    state = { configured, label: label(), reachable: Object.keys(handoffs).length ? remote !== null : state.reachable, items };
    const sig = JSON.stringify(state);
    if (sig !== last) {
      last = sig;
      bb.realtime.publish("machine-handoffs", { at: Date.now() });
    }
    return state;
  };

  // A new handoff should show up straight away, not on the next poll.
  let watcher: fs.FSWatcher | null = null;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    watcher = fs.watch(CONFIG_DIR, (_e, name) => {
      if (name === path.basename(FILE) || name === "profile.json") void refresh().catch(() => undefined);
    });
  } catch (e) {
    bb.log.warn(`always-on: cannot watch ${CONFIG_DIR}: ${String(e)}`);
  }
  bb.onDispose(() => watcher?.close());

  bb.background.service("machine-status", {
    async start(signal) {
      while (!signal.aborted) {
        await refresh(signal).catch((e) => bb.log.warn(`always-on status: ${String(e)}`));
        if (signal.aborted) break;
        await new Promise((r) => {
          const t = setTimeout(r, POLL_MS);
          signal.addEventListener("abort", () => { clearTimeout(t); r(null); }, { once: true });
        });
      }
    },
  });

  return { get: () => state, refresh };
}
