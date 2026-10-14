// Navigation you can fold: bb's sidebar navigation (New thread, Search, Board,
// Automations, plugin pages, More) under one "Navigate" row. Click the row to
// fold the whole list to that line, so the rail moves up; right-click it to
// hide the navigation entirely ("Show navigation" in the rail's right-click
// menu brings it back). The choice is kept in localStorage; ⌘⇧B toggles it.
//
// The rows themselves stay bb's own: experimental_Original renders bb's bundled
// Navigation plugin, so clicks, the active item, the "…" menus, More, drag to
// reorder and keyboard focus behave exactly as before. It stays mounted while
// folded (only hidden), so nothing it listens for is lost. If a later bb drops
// experimental_Original, the rows are drawn from experimental_useSidebarNavigation.
import { useState, useSyncExternalStore } from "react";
import type { ComponentType, MouseEvent } from "react";
import {
  experimental_Icon as Icon,
  experimental_SidebarNavigationIcon as NavIcon,
  experimental_useSidebarNavigation as useSidebarNavigation,
  experimental_useSidebarNavigationSplit as useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { tnum } from "./shared";
import { Dropdown, DropItem, DropSeparator, Menu, MenuItem, MenuSeparator } from "./menu";

/* ------------------------------ state ------------------------------ */

export type NavMode = "open" | "folded" | "hidden";
const KEY = "nav-skin:nav";
/** Debug switch: "own" draws the rows from the hook even when bb's original is there. */
const RENDERER_KEY = "nav-skin:nav-renderer";
export const NAV_SHORTCUT = "⌘⇧B";

function read(): NavMode {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "folded" || v === "hidden" ? v : "open";
  } catch {
    return "open";
  }
}

let mode: NavMode = typeof window === "undefined" ? "open" : read();
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      mode = read();
      notify();
    }
  });
}

export function setNavMode(next: NavMode) {
  mode = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  notify();
}

/** Fold when open; open when folded or hidden. */
export function toggleNav() {
  setNavMode(mode === "open" ? "folded" : "open");
}

export function useNavMode(): NavMode {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => mode,
    () => "open",
  );
}

/* ----------------------------- provider ---------------------------- */

export function FoldableNavigation({ isCompactViewport, experimental_Original }: ExperimentalSidebarNavigationProps) {
  const navMode = useNavMode();
  const nav = useSidebarNavigation();
  const [ownRows] = useState(() => {
    try {
      return window.localStorage.getItem(RENDERER_KEY) === "own";
    } catch {
      return false;
    }
  });
  const Original = (experimental_Original as ComponentType | undefined) ?? null;
  const folded = navMode !== "open";

  return (
    <div data-nav-skin-nav={navMode}>
      {navMode === "hidden" ? null : (
        <Menu
          trigger={
            <button
              type="button"
              aria-expanded={!folded}
              aria-controls="nav-skin-nav-rows"
              aria-keyshortcuts="Meta+Shift+B"
              title={folded ? `Show the navigation (${NAV_SHORTCUT})` : `Fold the navigation (${NAV_SHORTCUT}). Right-click for more.`}
              onClick={() => setNavMode(folded ? "open" : "folded")}
              className={cn(
                "group/navhead mx-2 flex h-7 w-[calc(100%-1rem)] items-center gap-1.5 rounded-md pl-2 pr-1.5 text-left outline-none",
                "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                folded ? "mt-2 mb-1" : "mt-2 -mb-1.5",
              )}
            >
              <span className="flex-1">Navigate</span>
              {folded ? <span className="normal-case tracking-normal opacity-0 transition-opacity group-hover/navhead:opacity-70" style={tnum}>{NAV_SHORTCUT}</span> : null}
              <Icon name="ChevronDown" className={cn("size-3.5 opacity-70 transition-transform duration-150", folded && "-rotate-90")} />
            </button>
          }
        >
          <MenuItem icon={folded ? "ChevronsDown" : "ChevronsUp"} label={folded ? "Unfold navigation" : "Fold navigation"} hint={NAV_SHORTCUT} onSelect={() => setNavMode(folded ? "open" : "folded")} />
          <MenuItem icon="EyeOff" label="Hide navigation entirely" onSelect={() => setNavMode("hidden")} />
          <MenuSeparator />
          <MenuItem icon="Settings" label="Customise items…" onSelect={() => nav.actions.openCustomize()} />
        </Menu>
      )}
      {/* Kept mounted while folded or hidden, so bb's rows keep their own state. */}
      <div id="nav-skin-nav-rows" hidden={folded}>
        {Original && !ownRows ? <Original /> : <OwnRows compact={isCompactViewport} />}
      </div>
    </div>
  );
}

/* ------------------- fallback rows (no experimental_Original) ------------------- */

function OwnRows({ compact }: { compact: boolean }) {
  const nav = useSidebarNavigation();
  const shown = nav.items.filter((i) => i.isVisible);
  const tucked = nav.items.filter((i) => !i.isVisible);
  return (
    <div className="relative shrink-0 space-y-0.5 px-2 py-2" data-nav-skin-own-rows="">
      {shown.map((item) => (
        <NavRow key={item.id} item={item} active={nav.activeItemId === item.id} showShortcut={nav.isShortcutModifierHeld} compact={compact} />
      ))}
      <Dropdown
        side="right"
        trigger={
          <button type="button" className={cn(rowClass, "text-muted-foreground")}>
            <Icon name="MoreHorizontal" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">More</span>
          </button>
        }
      >
        {tucked.map((item) => (
          <DropItem
            key={item.id}
            lead={<NavIcon icon={item.icon} className="size-4" />}
            label={item.label}
            onSelect={() => nav.actions.activate(item.id, { openInSplit: false })}
          />
        ))}
        {tucked.length > 0 ? <DropSeparator /> : null}
        <DropItem icon="Settings" label="Customise…" onSelect={() => nav.actions.openCustomize()} />
      </Dropdown>
    </div>
  );
}

const rowClass =
  "group/nav-row flex h-[var(--bb-sidebar-row-height,2rem)] w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md pl-2 pr-7 text-sm " +
  "text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring " +
  "disabled:cursor-default disabled:opacity-70";

function NavRow({ item, active, showShortcut, compact }: { item: ExperimentalSidebarNavigationItem; active: boolean; showShortcut: boolean; compact: boolean }) {
  const nav = useSidebarNavigation();
  const split = useSidebarNavigationSplit(item.id);
  const Accessory = item.experimental_Accessory;
  const activate = (e: MouseEvent) => nav.actions.activate(item.id, { openInSplit: split.isAvailable && (e.metaKey || e.ctrlKey) && !compact });
  return (
    <div className="group/row relative" data-sidebar-navigation-item={item.id}>
      <button
        type="button"
        {...split.splitProps}
        disabled={item.isDisabled || item.isLoading}
        aria-pressed={active}
        aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
        onClick={activate}
        className={cn(rowClass, active && "bg-state-active text-foreground")}
      >
        <NavIcon icon={item.icon} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        {showShortcut && item.shortcut ? <span className="text-[11px] text-muted-foreground">{item.shortcut.label}</span> : Accessory ? <Accessory /> : null}
      </button>
      <div className="absolute inset-y-0 right-0 flex items-center opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
        <Dropdown
          side="right"
          trigger={
            <button type="button" aria-label={`${item.label} options`} className="m-1 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent">
              <Icon name="MoreHorizontal" className="size-4" />
            </button>
          }
        >
          {split.isAvailable ? <DropItem icon="Columns2" label="Open in split" onSelect={() => nav.actions.activate(item.id, { openInSplit: true })} /> : null}
          <DropItem icon="EyeOff" label="Move to More" onSelect={() => nav.actions.setVisible(item.id, false)} />
          <DropItem icon="Settings" label="Customise…" onSelect={() => nav.actions.openCustomize()} />
          {item.pluginId ? (
            <>
              <DropSeparator />
              <DropItem icon="Info" label="Plugin details" onSelect={() => nav.actions.openDetails(item.id)} />
            </>
          ) : null}
        </Dropdown>
      </div>
    </div>
  );
}
