# BB Overlay

**A complete front end for [bb](https://getbb.app), from [NavAIgate](https://navaigate.dev).** One place for your agents, your inbox, your calendar and your to-dos, with a voice agent and the option to hand work to an always-on machine.

> **In plain words**
>
> - Free to download and use, for yourself or for your own business.
> - Change it as much as you like for your own use.
> - Don't sell it, re-upload it, share copies of it, or put it in a course, template pack or community (Skool or anywhere else).
> - Keep the NavAIgate name and logo as they are, and don't present it as your own work.
> - Want to do something else with it? Ask first: [navaigate.dev](https://navaigate.dev).
>
> The legal terms are in [LICENSE](LICENSE) (PolyForm Internal Use 1.0.0) and [NOTICE](NOTICE). If this box and those files ever disagree, the files win.

## What's inside

Two bb plugins:

- **NavAIgate Workspace** (`plugins/workspace`)
  - **Home:** a greeting, your daily brief, an Ask box that Jev routes to the right harness, today's calendar, mail that needs a reply, social posts, and how much of each subscription you've used.
  - **Inbox:** every email from your Gmail accounts, read-only. "Sort with Jev" puts each one in a pile (Reply today, Clients, Partners, Billing, Community, Newsletters and more). "Hand to agent" starts a chat that drafts the reply but never sends it.
  - **Calendar:** your Google Calendars as a month view, with your booking links.
  - **The rail:** a run-sheet sidebar with a NOW card, a harness filter, tags, folders, "Come back later", and right-click on everything.
  - **To-do and Board:** to-dos linked to chats, which move on their own as the chats start and finish.
  - **Agents panel:** start any agent from `~/.claude/agents` in one click and watch the whole family of chats.
  - **Talk:** the Savvy voice agent on ElevenLabs. Speak to whichever harness chat you have open.
  - **Always-on machine:** right-click a chat and choose "Send to my always-on machine" (a home Mac, mini PC or VPS). The chat carries on there, a cloud on the row shows its status, and a panel shows its progress live.
  - **Home or away (optional):** if your files live on a NAS, new chats start on the share at home and on a local copy when you're away.
  - **The NavAIgate theme**, chat charts and link cards.
- **Kanban** (`plugins/kanban`): a board where every card is a chat. Agents move their own cards from Backlog to In progress, Review and Done.

## Install

You need bb installed and signed in to at least one harness (Claude Code, Codex or Cursor).

**The easy way.** Open a chat in bb and paste:

```text
Install the two bb plugins from https://github.com/skyremote/bb-overlay:
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin workspace
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin kanban
Then open Home and walk me through Set up.
```

**From a terminal:**

```sh
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin workspace
bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin kanban
```

Then pick the look in bb: **Settings, Appearance**. Choose the NavAIgate theme, the NavAIgate sidebar header, and the NavAIgate rail as the thread list.

Not technical? Follow the step-by-step guide in [INSTALL.md](INSTALL.md).

## Set up (first run)

Open **Home**. Until you finish setting up, Home shows the Set up wizard. You can reopen it any time from **Set up** in the sidebar, or with **Workspace: set up** in the command palette.

1. **You:** your first name, used in greetings and by your agents.
2. **Your work:** two to five areas of your work and life, each with a one-line description. Jev uses them to tag email and route requests.
3. **Your tools:** your own API keys. Every one is optional, and each has a Test button:

   | Key | Powers | Get it |
   | --- | --- | --- |
   | Composio | Inbox, Calendar, Hand to agent. Connect Gmail and Google Calendar in Composio first | [platform.composio.dev](https://platform.composio.dev) |
   | Jev (TypeSafe) | Inbox sorting, Ask box routing | [typesafe.ai](https://typesafe.ai) |
   | ElevenLabs | Talk (voice agent) | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) |
   | Calendly | Booking links on Calendar | [calendly.com](https://calendly.com/integrations/api_webhooks) |
   | Blotato | Social and Audience on Home | [blotato.com](https://my.blotato.com/settings) |

4. **Always-on machine** (optional): its SSH host, and optional storage at home.

Everything is saved on your computer only, in `~/.config/navaigate-workspace/` (`profile.json`, and `keys.env`, readable only by you). Nothing is sent to NavAIgate.

## The always-on machine

Any machine that stays on and that you can reach over SSH with a key: a Mac at home, a mini PC, or a VPS.

1. On that machine, install bb, sign in to the harnesses you use, and install these same plugins.
2. Run `bb connect` there once, so you get a `getbb.app` link to watch its chats from your laptop or phone.
3. Make sure `ssh <host> true` works from your laptop without a password prompt. Tailscale makes this easy from anywhere.
4. Enter the host in Set up and press **Test SSH**.

Then right-click any chat and choose **Send to my always-on machine**. The plugin writes a hand-off brief from the conversation, copies over any laptop-only files the chat mentions, and starts the chat there. Your agents can drive it too, through the bundled `always-on` skill: `always-on send`, `list`, `show`, `tell` and `pull`, plus `fetch`, `push` and `put` when you've set up storage at home.

## Requirements and costs

- bb 0.44 or later, on macOS. The always-on machine can be macOS or Linux.
- Your own subscriptions: Claude Code, Codex or Cursor for the harnesses, plus any of the services above you choose to connect. Each one bills you directly.

## Updating

```sh
bb plugin update navaigate-workspace
bb plugin update kanban
```

---

Made by [NavAIgate](https://navaigate.dev). "NavAIgate" and the NavAIgate logo are trademarks of NavAIgate GmbH & Co. KG and are not licensed for any other use. See [NOTICE](NOTICE).
