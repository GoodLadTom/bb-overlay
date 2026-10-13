#!/usr/bin/env bash
# BB Overlay installer, from NavAIgate (https://navaigate.dev).
#
# Installs everything BB Overlay uses, in one go:
#   - NavAIgate Workspace and Kanban, from this repository
#   - Projects & Sections (project-folders) by VKirill, MIT, from its own repository
#   - Agent Board by aaronphifer, MIT, from its own repository
#   - bb's built-in Tasks plugin (opt-in in bb, so it is installed if missing)
# then turns on the NavAIgate theme and rail, reloads, and prints a checklist.
#
# Safe to run again: anything already installed is updated within its own pin,
# and nothing is ever removed or downgraded. A plugin you installed from
# somewhere else (a local copy, say) is left exactly as it is.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/skyremote/bb-overlay/main/install.sh | bash
#   bash install.sh [--dry-run] [--no-look] [--help]
#
#   --dry-run   print every command, change nothing
#   --no-look   leave the theme and the sidebar list as they are

set -euo pipefail

EDITION="BB Overlay"
REPO_URL="https://github.com/skyremote/bb-overlay.git"
REPO_REF="main"
MIN_BB="0.45"

PF_SOURCE="git:https://github.com/VKirill/bb-plugin-project-folders.git@semver:^0.6.0"
PF_MATCH="github.com/VKirill/bb-plugin-project-folders"
AB_SOURCE="git:https://github.com/aaronphifer/bb-plugin-agent-board.git@semver:^0.6.1"
AB_MATCH="github.com/aaronphifer/bb-plugin-agent-board"

WS_ID="navaigate-workspace"
THEME_ID="plugin:${WS_ID}:navaigate"
RAIL_ID="${WS_ID}/rail"

DRY_RUN=0
SET_LOOK=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-look) SET_LOOK=0 ;;
    -h|--help) sed -n '2,22p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

W_INST="[installed]  "; W_UPD="[up to date] "
if [ "$DRY_RUN" -eq 1 ]; then W_INST="[would install]"; W_UPD="[would update] "; fi

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'Note: %s\n' "$*" >&2; }
die()  { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

# Print a command, then run it (or only print it with --dry-run).
run() {
  printf '  $ %s\n' "$*"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  "$@"
}

CHANGED=()   # plugin ids installed or updated in this run (reloaded at the end)
OUTCOME=()   # checklist lines

# ---------------------------------------------------------------- bb itself
step "Checking bb"
BB="$(command -v bb || true)"
if [ -z "$BB" ] && [ -x "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb" ]; then
  BB="/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb"
fi
[ -n "$BB" ] || die "bb is not installed, or its command is not on your PATH. Install bb from https://getbb.app, open it once, then run this again."
bb() { "$BB" "$@"; }

BB_VERSION="$(bb --version 2>/dev/null | head -n1 | tr -d '[:space:]')"
say "bb $BB_VERSION"
version_lt() { # true when $1 < $2 (major.minor.patch)
  local IFS=.
  # shellcheck disable=SC2206
  local a=($1) b=($2)
  for i in 0 1 2; do
    local x="${a[$i]:-0}" y="${b[$i]:-0}"
    x="${x%%[!0-9]*}"; y="${y%%[!0-9]*}"
    [ "${x:-0}" -lt "${y:-0}" ] && return 0
    [ "${x:-0}" -gt "${y:-0}" ] && return 1
  done
  return 1
}
if version_lt "$BB_VERSION" "$MIN_BB"; then
  warn "BB Overlay is tested on bb $MIN_BB and later. Update bb first (bb updates, or download it again from getbb.app); installing anyway."
fi

PLUGIN_LIST="$(bb plugin list 2>/dev/null)" || die "bb is installed but not answering. Open the bb app, wait for it to load, then run this again."

# The repository must be reachable (the members' edition is private).
if command -v git >/dev/null 2>&1; then
  if ! GIT_TERMINAL_PROMPT=0 git ls-remote "$REPO_URL" HEAD >/dev/null 2>&1; then
    die "Can't reach $REPO_URL. If it is private, check you have access, then sign git in to GitHub (for example: gh auth login, then gh auth setup-git) and run this again."
  fi
fi

# ---------------------------------------------------------------- helpers
# plugin_line <id> -> "<version> <status>" or empty when not installed
plugin_line() {
  printf '%s\n' "$PLUGIN_LIST" | awk -v id="$1" '
    $0 ~ /^[^ ]/ { split($1, p, "@"); if (p[1] == id) { print p[2], $2; exit } }'
}
# plugin_source <id> -> source string or empty
plugin_source() {
  printf '%s\n' "$PLUGIN_LIST" | awk -v id="$1" '
    $0 ~ /^[^ ]/ { split($1, p, "@"); cur = p[1]; next }
    cur == id && $1 == "source:" { sub(/^ *source: */, ""); print; exit }'
}

# ensure <id> <label> <match-in-source> <install args...>
ensure() {
  local id="$1" label="$2" match="$3"; shift 3
  local line src status
  line="$(plugin_line "$id")"
  if [ -z "$line" ]; then
    say "$label: not installed, installing."
    if run bb plugin install "$@" --yes; then
      CHANGED+=("$id"); OUTCOME+=("$W_INST $label")
    else
      OUTCOME+=("[FAILED]     $label: install failed, see above")
    fi
    return 0
  fi
  src="$(plugin_source "$id")"
  status="${line#* }"
  if [[ "$src" == builtin:* ]]; then
    say "$label: installed (${line%% *}, updates with bb)."
    OUTCOME+=("[ok]         $label")
  elif [ -n "$match" ] && [[ "$src" != *"$match"* ]]; then
    say "$label: already installed from $src. Keeping your copy as it is."
    OUTCOME+=("[kept]       $label (your own copy: $src)")
  else
    say "$label: installed (${line%% *}), checking for an update."
    if run bb plugin update "$id" --yes; then
      CHANGED+=("$id"); OUTCOME+=("$W_UPD $label")
    else
      OUTCOME+=("[ok]         $label (update check failed, kept ${line%% *})")
    fi
  fi
  if [ "$status" = "disabled" ]; then
    say "$label is turned off, turning it on."
    run bb plugin enable "$id" || warn "Couldn't turn on $label. Try: bb plugin enable $id"
  fi
}

# ---------------------------------------------------------------- plugins
step "Installing $EDITION"
ensure "$WS_ID" "NavAIgate Workspace" "$REPO_URL" "git:${REPO_URL}@${REPO_REF}" --plugin workspace
ensure "kanban" "Kanban" "$REPO_URL" "git:${REPO_URL}@${REPO_REF}" --plugin kanban

step "Installing the companions (made by other people, MIT, from their own repositories)"
ensure "project-folders" "Projects & Sections by VKirill (folders, Move to folder)" "$PF_MATCH" "$PF_SOURCE"
ensure "agent-board" "Agent Board by aaronphifer" "$AB_MATCH" "$AB_SOURCE"

step "Checking bb's built-in plugins"
# Tasks powers To-do and the Board. It ships with bb but is opt-in.
ensure "tasks" "Tasks (built into bb; To-do and Board)" "" tasks
# Account Pooler is optional: it routes Claude and Codex traffic across your
# accounts, so we report it rather than switch it on for you.
ap="$(plugin_line account-pool)"
case "${ap#* }" in
  "") OUTCOME+=("[optional]   Account Pooler (built into bb): not present in this bb") ;;
  disabled) OUTCOME+=("[optional]   Account Pooler (built into bb) is off. Turn it on with: bb plugin enable account-pool, then add accounts with: bb pool") ;;
  *) OUTCOME+=("[ok]         Account Pooler (built into bb)") ;;
esac

# ---------------------------------------------------------------- reload
if [ "${#CHANGED[@]}" -gt 0 ]; then
  step "Reloading"
  for id in "${CHANGED[@]}"; do run bb plugin reload "$id" || warn "Couldn't reload $id. Reload bb with Cmd-R (Ctrl-R on Linux)."; done
fi

# ---------------------------------------------------------------- the look
manual_look() {
  say "Set the look by hand in bb: Settings, Appearance."
  say "  Theme: NavAIgate"
  say "  Thread list: NavAIgate rail"
}
step "The NavAIgate theme and rail"
if [ "$SET_LOOK" -eq 0 ]; then
  say "Skipped (--no-look)."
  OUTCOME+=("[skipped]    Theme and rail (--no-look)")
elif ! bb theme --help >/dev/null 2>&1 || ! bb settings ui --help >/dev/null 2>&1; then
  manual_look
  OUTCOME+=("[by hand]    Theme and rail: Settings, Appearance")
else
  rail="$(bb settings ui get sidebar.threadListProvider 2>/dev/null | tr -d '"[:space:]' || true)"
  theme="$(bb theme show 2>/dev/null | head -n1 || true)"
  if [ "$rail" = "$RAIL_ID" ]; then
    say "The NavAIgate rail is already your sidebar list."
  elif [[ "$rail" == *navaigate* ]]; then
    # Another NavAIgate rail (a personal build) is in use: leave the look alone.
    say "Another NavAIgate rail ($rail) is your sidebar list. Leaving your theme and rail as they are."
    OUTCOME+=("[kept]       Theme and rail (your own NavAIgate rail: $rail)")
    SET_LOOK=0
  else
    [ -n "$rail" ] && say "Sidebar list was: $rail (to go back: bb settings ui set sidebar.threadListProvider $rail)"
    run bb settings ui set sidebar.threadListProvider "$RAIL_ID" || { warn "Couldn't set the rail."; manual_look; }
  fi
  if [ "$SET_LOOK" -eq 1 ]; then
    if [[ "$theme" == *"$THEME_ID"* ]]; then
      say "The NavAIgate theme is already on."
    else
      [ -n "$theme" ] && say "Theme was: $theme (to go back: bb theme reset, or bb theme set <id>)"
      run bb theme set "$THEME_ID" || { warn "Couldn't set the theme."; manual_look; }
    fi
    OUTCOME+=("[ok]         NavAIgate theme and rail")
  fi
fi

# ---------------------------------------------------------------- checklist
step "Checklist"
[ "$DRY_RUN" -eq 1 ] && say "(dry run: nothing was changed)"
for l in "${OUTCOME[@]}"; do say "  $l"; done
cat <<EOF

Next:
  1. Reload bb (Cmd-R on a Mac, Ctrl-R on Linux).
  2. Open Home in the sidebar and walk through Set up.
Run this again any time to update everything. It never removes anything.
EOF
