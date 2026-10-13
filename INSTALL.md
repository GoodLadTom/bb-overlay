# Install BB Overlay, step by step

About 15 minutes. No coding needed: bb's agent does the technical part for you.

## Before you start

- A Mac with **bb** installed ([getbb.app](https://getbb.app)).
- At least one AI harness signed in inside bb: Claude Code, Codex or Cursor.
- Optional, for the full experience: accounts with **Composio** (email and calendar), **TypeSafe** (Jev, the inbox sorter), **ElevenLabs** (voice), **Calendly** and **Blotato**. You can add these later.

## 1. Install the plugins

1. Open bb and start a new chat (any project is fine).
2. Paste this message and send it:

   ```text
   Install the two bb plugins from https://github.com/skyremote/bb-overlay:
   bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin workspace
   bb plugin install git:https://github.com/skyremote/bb-overlay.git@main --plugin kanban
   Then open Home and walk me through Set up.
   ```

3. bb asks you to confirm each install, because plugins run on your computer. Approve both.
4. When it's finished, reload bb with **Cmd-R**.

**Got the zip instead?** Unzip it somewhere permanent (for example your Documents folder; bb runs the plugins from there, so don't delete it). Then in a bb chat say: "In the folder `<drag the unzipped folder here>`, run `npm ci` inside `plugins/workspace` and `plugins/kanban`, then install both with `bb plugin install path:<that folder> --plugin workspace` and `--plugin kanban`."

**Optional companion.** For real folders in the sidebar, also install the free Projects & Sections plugin (made by someone else, not part of BB Overlay):

```text
bb plugin install git:https://github.com/VKirill/bb-plugin-project-folders.git@semver:^0.6.0
```

## 2. Turn on the look

In bb, open **Settings, then Appearance**:

- **Theme:** NavAIgate
- **Thread list:** NavAIgate rail
- **Sidebar header:** NavAIgate (only on bb 0.44 and 0.45; bb 0.46 removed this option, so skip it there)

## 3. Set up your workspace

Click **Home** in the sidebar. The Set up wizard opens.

1. **You:** type your first name.
2. **Your work:** name two to five areas of your work and life, and describe each in a line. For example, "Agency: client projects, proposals and invoices" or "Community: my Skool group, members and events".
3. **Your tools:** for each service you use, click **Get a key**, copy your key, paste it in, and press **Test**. Skip any you don't use; that part of Home just stays empty.
   - **Composio:** after creating your account, connect **Gmail** and **Google Calendar** inside Composio first, then copy the API key.
4. **Always-on machine:** skip this for now unless you already have a home Mac or VPS you can reach over SSH. See the README when you're ready, including how to add it to bb so you can start and move chats there.
5. Press **Save and open Home**.

Your name and keys are saved only on your Mac, in a hidden folder called `.config/navaigate-workspace` in your home folder. Nothing is sent to NavAIgate.

## 4. Try it

- **Home:** type a request in the Ask box. Leave it on **Auto** and Jev picks the best harness.
- **Inbox:** press **Sort with Jev**, then open an email and press **Hand to agent** for a draft reply. It never sends without you.
- **Any chat:** right-click it in the sidebar to tag it, move it to a folder, or mark it "Come back later".
- **Talk:** press **Talk** at the top of a chat and speak.
- **Kanban:** open **Kanban** in the sidebar to see every chat as a card.
- **Tabs:** every chat you open gets a tab at the top. Hover for a preview, drag to reorder.
- **Sub-agents:** while a chat has sub-agents working, type a message and press **Send when sub-agents finish** under the chat box.

## If something isn't working

- **A Home card says to add a key:** open **Set up** in the sidebar and add or test that key.
- **The inbox is empty:** check that Gmail is connected in Composio, then press **Test** next to Composio in Set up. It tells you how many Gmail accounts it found.
- **Home is blank on bb 0.46:** update to BB Overlay 1.1.0 (`bb plugin update navaigate-workspace`), then reload with Cmd-R.
- **Anything else:** ask in a bb chat: "NavAIgate Workspace isn't showing X, can you check the plugin?" The agent can read the plugin's logs.

## The rules, in plain words

Free for you and your own business. Change it for yourself. Don't sell it, re-upload it, share copies of it, or put it in a course or community. Keep the NavAIgate name and logo. The full terms are in [LICENSE](LICENSE) and [NOTICE](NOTICE).
