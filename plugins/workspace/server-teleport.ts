// Teleport-lite: move a chat to the always-on machine and back.
//
// bb cannot fork a thread onto another machine: the server refuses with "Fork
// environment must use the source thread's host" (tested 12 Oct 2026, bb
// 0.45). So a move is a brief, not a fork: the plugin writes a handoff brief
// from the conversation (the same brief "Send to my always-on machine" uses) and starts a NEW chat
// from it. Where that chat runs:
//   - the always-on machine as a machine of THIS bb, when the project has a
//     checkout there, so the chat stays in this sidebar;
//   - otherwise the always-on machine's own bb, through the existing
//     `always-on send` handoff.
// Either way the local chat is stopped, linked to the new one (plugin
// metadata) and archived, so it can be restored. Nothing is deleted.
//
// Git: storage at home needs nothing, the other machine sees the same files.
// A repo is pushed so the other machine can check it out: the current branch when
// it is clean, or, with uncommitted changes and the member's say-so, a WIP commit on
// `teleport/<thread>` built from a temporary index, so neither the working
// tree nor any local branch (main included) moves. The other machine works in a
// fresh worktree from that ref, leaving its own checkout alone.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { handOff, transcript } from "./server-machine";
import { isShared, type createMachines } from "./server-machines";
import { profile } from "./server-profile";

const PLUGIN_ID = "navaigate-workspace";
const NAME = () => profile().machine?.label?.trim() || "your always-on machine";

export const teleportLinkSchema = z.object({
  /** The other side of the move, or null. */
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** "machine": a chat on the always-on machine in this bb. "handoff": that machine's own bb. */
  via: z.enum(["machine", "handoff"]).nullable(),
  branch: z.string().nullable(),
  at: z.number().nullable(),
  /** This chat runs on the always-on machine. */
  onMachine: z.boolean(),
});
export type TeleportLink = z.infer<typeof teleportLinkSchema>;

export const teleportMoveInput = z.object({
  threadId: z.string().min(1),
  /** What to do with uncommitted changes: unset asks first. */
  dirty: z.enum(["carry", "leave"]).optional(),
});
export const teleportMoveOutput = z.object({
  /** Set when the move needs a choice first; nothing has changed yet. */
  needs: z.object({ kind: z.literal("dirty"), files: z.number(), branch: z.string().nullable() }).nullable(),
  newThreadId: z.string().nullable(),
  via: z.enum(["machine", "handoff"]).nullable(),
  url: z.string().nullable(),
  notes: z.array(z.string()),
});
export type TeleportMoveOutput = z.infer<typeof teleportMoveOutput>;

type Env = { id: string; hostId: string; path: string; isGitRepo: boolean; isWorktree: boolean; branchName: string | null; workspaceProvisionType?: string };
type ThreadGet = { thread: { id: string; projectId: string; providerId: string; title: string | null; titleFallback?: string | null; status: string }; environment: Env | null };
type Flat = ThreadGet["thread"] & { environment?: Env | null; thread?: ThreadGet["thread"] };

const PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin", ...(process.env.PATH ?? "").split(":")]
  .filter((d, i, all) => d && all.indexOf(d) === i)
  .join(":");

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts.cwd, env: { ...process.env, PATH, ...opts.env }, timeout: opts.timeout ?? 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split("\n").slice(-3).join(" ")));
      else resolve(stdout);
    });
  });
}
const git = (cwd: string, args: string[], env?: Record<string, string>) => sh("git", args, { cwd, env, timeout: 120_000 });
const ssh = (remote: string) => {
  const host = profile().machine?.sshHost ?? "";
  if (!host) return Promise.reject(new Error("No always-on machine set up yet. Add one in Set up."));
  return sh("/usr/bin/ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, remote], { timeout: 120_000 });
};
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const branchFor = (threadId: string) => `teleport/${threadId}`;

/** A commit of everything in the working tree (tracked and untracked), on top of HEAD, without touching the index, tree or branches. */
async function wipCommit(cwd: string, message: string): Promise<string> {
  const index = path.join(os.tmpdir(), `teleport-index-${process.pid}-${Date.now()}`);
  try {
    const env = { GIT_INDEX_FILE: index };
    await git(cwd, ["read-tree", "HEAD"], env);
    await git(cwd, ["add", "-A"], env);
    // bb's own per-chat files are not work to carry.
    await git(cwd, ["rm", "-r", "--cached", "--ignore-unmatch", "-q", ".bb"], env);
    const tree = (await git(cwd, ["write-tree"], env)).trim();
    return (await git(cwd, ["commit-tree", tree, "-p", "HEAD", "-m", message])).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

export function createTeleport(bb: BbPluginApi, machines: ReturnType<typeof createMachines>) {
  /** The SDK returns the thread itself, with its environment when asked for. */
  const getThread = async (threadId: string): Promise<ThreadGet> => {
    const r = (await bb.sdk.threads.get({ threadId, include: "environment" })) as unknown as Flat;
    const thread = r.thread ?? r;
    return { thread, environment: r.environment ?? null };
  };
  const getLink = async (threadId: string): Promise<TeleportLink> => {
    const meta = (await bb.sdk.threads.getPluginMetadata({ threadId, pluginId: PLUGIN_ID }).catch(() => ({}))) as Record<string, unknown>;
    const t = (meta.teleport ?? {}) as Partial<TeleportLink>;
    const host = await machines.machineHost().catch(() => null);
    const got = await getThread(threadId).catch(() => null);
    return {
      from: t.from ?? null,
      to: t.to ?? null,
      via: t.via ?? null,
      branch: t.branch ?? null,
      at: t.at ?? null,
      onMachine: !!host && got?.environment?.hostId === host.id,
    };
  };
  const setLink = (threadId: string, link: Partial<TeleportLink>) =>
    bb.sdk.threads.updatePluginMetadata({ threadId, pluginId: PLUGIN_ID, set: { teleport: { ...link, at: Date.now() } } });

  const stopIfRunning = async (t: ThreadGet["thread"]) => {
    if (["active", "starting"].includes(t.status)) await bb.sdk.threads.stop({ threadId: t.id }).catch(() => undefined);
  };

  const briefFor = async (threadId: string, title: string, lines: string[]) => {
    const convo = await transcript(threadId);
    return [
      `# ${title}`,
      "",
      "This chat was moved here part-way through (bb cannot fork a chat across machines, so this is a brief of it).",
      "Below is the conversation so far. Work out what was being done and what is still open, then carry on",
      "from exactly where it stopped. Act on the most recent clear request; don't redo finished steps.",
      ...lines,
      "",
      "## Conversation so far",
      "",
      convo,
    ].join("\n");
  };

  /** Move a chat on this computer to the always-on machine. */
  async function move(input: z.infer<typeof teleportMoveInput>): Promise<TeleportMoveOutput> {
    const got = await getThread(input.threadId);
    const t = got.thread;
    const env = got.environment;
    const title = t.title || t.titleFallback || "Moved chat";
    const notes: string[] = [];
    if (!profile().machine) throw new Error("No always-on machine set up yet. Add one in Set up.");
    const mach = await machines.forProject(t.projectId);
    const local = env?.path ?? null;
    const viaMachine = !!(mach.hostId && mach.connected && mach.sourcePath);

    // 1. Git: decide what the other machine checks out, before anything changes.
    let branch: string | null = null;
    let carry = false;
    const isRepo = !!(local && env?.isGitRepo && !isShared(local));
    if (isRepo && local) {
      const dirty = (await git(local, ["status", "--porcelain"])).split("\n").filter(Boolean).length;
      branch = env?.branchName ?? ((await git(local, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || null);
      if (dirty && !input.dirty) return { needs: { kind: "dirty", files: dirty, branch }, newThreadId: null, via: null, url: null, notes };
      carry = dirty > 0 && input.dirty === "carry";
      if (dirty && !carry) notes.push(`${dirty} uncommitted change${dirty === 1 ? "" : "s"} stayed on this computer.`);
    }

    // 2. Stop the local turn.
    await stopIfRunning(t);

    // 3. Push what the other machine needs.
    if (isRepo && local) {
      if (carry) {
        const sha = await wipCommit(local, `WIP: teleport ${t.id} to ${NAME()}`);
        const ref = branchFor(t.id);
        await git(local, ["push", "origin", `${sha}:refs/heads/${ref}`]);
        notes.push(`Uncommitted work pushed as a WIP commit on ${ref}; ${branch ?? "your branch"} was not touched.`);
        branch = ref;
      } else if (branch && branch !== "HEAD") {
        await git(local, ["push", "origin", `HEAD:refs/heads/${branch}`]);
        notes.push(`Pushed ${branch}.`);
      }
    }

    const lines: string[] = [];
    if (isShared(local ?? "")) lines.push("This folder is shared storage, mounted at the same path on both machines, so the files are already here.");
    if (branch) lines.push(`The code is on branch ${branch} (fetched from origin into this worktree).`);
    let newThreadId: string | null = null;
    let url: string | null = null;
    let via: "machine" | "handoff";

    if (viaMachine && mach.hostId && mach.sourcePath) {
      // 4a. A new chat on the always-on machine, in this bb.
      via = "machine";
      let environment: Record<string, unknown> = { type: "host", hostId: mach.hostId, workspace: { type: "unmanaged", path: mach.sourcePath } };
      if (isRepo && branch) {
        await ssh(`git -C ${q(mach.sourcePath)} fetch origin ${q(`refs/heads/${branch}:refs/remotes/origin/${branch}`)}`);
        environment = { type: "host", hostId: mach.hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: `origin/${branch}` } } };
      } else if (local && !isShared(local)) {
        notes.push(`Not a git repo: ${NAME()} works in its own copy of the folder; local files were not carried.`);
      }
      const brief = await briefFor(t.id, title, lines);
      const made = (await bb.sdk.threads.spawn({
        projectId: t.projectId,
        environment: environment as never,
        providerId: t.providerId,
        title: `${title} · ${NAME()}`.slice(0, 120),
        visibility: "visible",
        permissionMode: "full",
        executionInputSources: { permissionMode: "explicit", providerId: "explicit" },
        pluginMetadata: { teleport: { from: t.id, to: null, via: "machine", branch, at: Date.now() } },
        prompt: brief,
      } as never)) as unknown as { id: string };
      newThreadId = made.id;
    } else {
      // 4b. Fallback: the always-on machine's own bb, through the existing brief handoff.
      via = "handoff";
      notes.push(
        mach.hostId
          ? `This project has no checkout on ${NAME()} in this bb, so it went to that machine's own bb as a brief.`
          : `${NAME()} is not a machine of this bb, so it went to that machine's own bb as a brief.`,
      );
      const res = await handOff({ threadId: t.id, title, providerId: t.providerId });
      newThreadId = res.remoteThread || null;
      url = res.url || null;
      notes.push(...res.notes);
    }

    // 5. Link both sides, then archive the local chat (restorable from the archive).
    await setLink(t.id, { from: null, to: newThreadId, via, branch });
    await bb.sdk.threads.archive({ threadId: t.id });
    bb.log.info(`teleport: ${t.id} -> ${newThreadId} via ${via}${branch ? ` (${branch})` : ""}`);
    bb.realtime.publish("teleport", { at: Date.now() });
    return { needs: null, newThreadId, via, url, notes };
  }

  /** Bring a chat that runs on the always-on machine back to the chat it came from. */
  async function back(threadId: string): Promise<TeleportMoveOutput> {
    const link = await getLink(threadId);
    const got = await getThread(threadId);
    const t = got.thread;
    const notes: string[] = [];
    if (!link.onMachine) throw new Error(`This chat is not running on ${NAME()}.`);
    await stopIfRunning(t);

    // The other machine's work: push it when it is a git worktree, so this computer can fetch it.
    let branch: string | null = null;
    const remotePath = got.environment?.path ?? null;
    if (remotePath && got.environment?.isGitRepo && !isShared(remotePath)) {
      branch = link.branch && link.branch.startsWith("teleport/") ? link.branch : branchFor(link.from ?? t.id);
      const status = await ssh(`git -C ${q(remotePath)} status --porcelain`).catch(() => "");
      if (status.trim()) {
        const script = [
          "set -e",
          `cd ${q(remotePath)}`,
          'IDX="$(mktemp)"',
          'trap \'rm -f "$IDX"\' EXIT',
          'GIT_INDEX_FILE="$IDX" git read-tree HEAD',
          'GIT_INDEX_FILE="$IDX" git add -A',
          'GIT_INDEX_FILE="$IDX" git rm -r --cached --ignore-unmatch -q .bb',
          'TREE="$(GIT_INDEX_FILE="$IDX" git write-tree)"',
          `SHA="$(git commit-tree "$TREE" -p HEAD -m ${q(`WIP: teleport ${t.id} back from ${NAME()}`)})"`,
          `git push origin "$SHA:refs/heads/${branch}" --force-with-lease=${branch}`,
        ].join("\n");
        await ssh(`bash -c ${q(script)}`);
        notes.push(`The uncommitted work on ${NAME()} was pushed as a WIP commit on ${branch}.`);
      } else {
        await ssh(`git -C ${q(remotePath)} push origin ${q(`HEAD:refs/heads/${branch}`)} --force-with-lease=${q(branch)}`).catch((e: unknown) => {
          notes.push(`Could not push the branch on ${NAME()}: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    }

    const brief = await briefFor(t.id, t.title || `Back from ${NAME()}`, [
      `You were working on this here, then it moved to ${NAME()}. Here is what happened there; carry on here.`,
      ...(branch ? [`The work from ${NAME()} is on branch ${branch}; fetch it (git fetch origin ${branch}) before continuing.`] : []),
    ]);

    let target = link.from;
    if (target) {
      // Restore the original chat and hand it what happened on the other machine.
      await bb.sdk.threads.unarchive({ threadId: target });
      await bb.sdk.threads.send({ threadId: target, mode: "auto", input: [{ type: "text", text: brief, mentions: [] }] } as never);
      await setLink(target, { from: t.id, to: null, via: "machine", branch });
    } else {
      // No chat to return to: start one in the project's local checkout.
      const mach = await machines.forProject(t.projectId);
      if (!mach.localHostId || !mach.localPath) throw new Error("This project has no checkout on this computer to come back to.");
      const made = (await bb.sdk.threads.spawn({
        projectId: t.projectId,
        environment: { type: "host", hostId: mach.localHostId, workspace: { type: "unmanaged", path: mach.localPath } },
        providerId: t.providerId,
        title: (t.title || `Back from ${NAME()}`).split(` · ${NAME()}`)[0],
        visibility: "visible",
        permissionMode: "full",
        executionInputSources: { permissionMode: "explicit", providerId: "explicit" },
        pluginMetadata: { teleport: { from: t.id, to: null, via: "machine", branch, at: Date.now() } },
        prompt: brief,
      } as never)) as unknown as { id: string };
      target = made.id;
    }
    await setLink(t.id, { from: link.from, to: target, via: "machine", branch });
    await bb.sdk.threads.archive({ threadId: t.id });
    bb.log.info(`teleport back: ${t.id} -> ${target}`);
    bb.realtime.publish("teleport", { at: Date.now() });
    return { needs: null, newThreadId: target, via: "machine", url: null, notes };
  }

  return { getLink, move, back };
}
