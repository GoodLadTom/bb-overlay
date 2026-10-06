---
name: always-on
description: Hand work to the user's always-on machine (a home Mac, mini PC or VPS running its own bb) and move files to and from storage at home through it. Use when the user says "send this to my machine", "run it at home", "run it on the VPS", "push this thread over", "do the heavy job on the always-on machine", "get me that file", "pull the results", or when they are away on a slow link and a job touches home storage. Also use to check on jobs there, send follow-ups, push an edited copy back, and clear local copies they no longer need.
---

# always-on: run it there, see it here

The always-on machine runs its own bb with the same plugins, skills and logins as the laptop. If the user has storage at home (a NAS or a big drive), that machine sits next to it, so jobs that touch it run fast there. The laptop only sends the brief and gets back the finished files.

Script: `always-on` in this folder. Run it with Bash, for example `bash <this folder>/always-on status`. It talks to the machine over SSH. The host, and any storage settings, come from `~/.config/navaigate-workspace/profile.json`, which "Set up workspace" in NavAIgate Workspace writes. If the script says no machine is set, tell the user to add one there.

## When to use it
- **The job is heavy, long, or must keep running while the laptop sleeps:** send it with `always-on send`.
- **The user is away and the job reads or writes home storage:** send it rather than working over a slow VPN.
- **They want a file from home storage to look at:** run `always-on fetch <path>` and open the local copy. A single fetch stream takes seconds, while opening the file over a slow network share can take minutes.
- **At home on the local network:** use the storage directly. Delegating isn't needed.

Run `always-on where` to see whether the user is home or away. It prints `home` when no storage is set up.

## Send a job
1. Write a self-contained brief. The thread on the machine can't see this conversation, so include:
   - **Goal:** the result wanted, in one or two lines.
   - **Inputs:** exact paths and any links.
   - **Decisions already made**, and constraints (voice, brand, what not to change).
   - **What's done so far**, and what's next.
   - **Where to save:** the folder the result belongs in.
2. Save it to a temp file and run:
   `always-on send --title "<short title>" [--provider codex|acp-cursor] [--project <bb project name>] -f /tmp/brief.md`
   - The default project is the storage home project if one is set, otherwise the personal workspace. The default provider is Claude Code.
   - `--folder <path>` runs the job inside that folder.
   - The script adds the house rules (save to storage when there is some, keep the reply short, end with an `OUTPUTS:` list) and rewrites this laptop's home-folder paths for the machine.
3. Give the user the `watch:` link it prints. That's the machine's bb, and they can follow the thread live from the laptop or phone.

**"Push this thread over"** means the same steps. Write the brief from the current conversation (goal, decisions, done, next, files), send it, then say the work continues there. bb can't move a live thread between machines; the brief is the handoff. The sidebar's "Send to my always-on machine" does this for the user in one click.

## Follow up and collect
- `always-on list`: recent threads on the machine.
- `always-on show <thread>`: status and final reply.
- `always-on tell <thread> -p "..."`: a follow-up message.
- `always-on pull <thread>`: fetches everything listed under `OUTPUTS:`. Files on home storage go to the local copy folder, at the same path. Files that only exist on the machine go to `~/AlwaysOn_Results/<thread>/`. Then open those local copies for the user.

## Files between home storage and the laptop (only with storage set up)
- `always-on fetch <path>...`: copies a file or folder to the local copy folder, at the same path.
- `always-on push <local path>...`: sends an edited local copy back. It refuses if the stored copy changed since the fetch, for example because someone else edited it. Fetch again, or set `ALWAYS_ON_FORCE=1` only if the user says to overwrite.
- `always-on put <file>... [--to <dir>]`: copies a laptop-only file to storage (or to the machine's home folder when there is no storage) so a job there can use it.
- `always-on clean [--days 14] [--yes]`: lists, then removes, local copies that are unchanged since fetch and unused for that many days. They are still in storage. Changed files are never removed; they're listed as not pushed.

## If something fails
- **`always-on status` says NOT logged in, or storage isn't readable:** tell the user exactly which item. On a Mac, storage access over SSH needs Full Disk Access for `/usr/sbin/sshd`.
- **SSH times out:** the machine is off, asleep or offline. Say so plainly.
- **No getbb.app link:** run `bb connect` on the machine once so the user can watch threads from anywhere.
- **Never** copy secrets into a brief.
