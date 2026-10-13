// The composer API (draft text, pickers) exists only inside a composer surface,
// but the chips live in an app overlay in the footer row. This invisible
// composer action publishes each mounted composer's API and view, keyed by its
// scope, so the chips can read the draft or switch the machine picker.
import { useEffect, useSyncExternalStore } from "react";
import { useComposer, useComposerView } from "@get-bb/plugin-sdk/app";
import type { ComposerView, PluginComposerApi } from "@get-bb/plugin-sdk/app";

export type ComposerHandle = { api: PluginComposerApi; view: ComposerView };

const live = new Map<string, ComposerHandle>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};

function keyOf(scope: PluginComposerApi["scope"]): string {
  if (scope.kind === "thread") return `thread:${scope.threadId}`;
  if (scope.kind === "new-thread") return "new";
  return scope.kind === "queued-message" ? `queued:${scope.queuedMessageId}` : `side:${scope.tabId}`;
}

export function ComposerBridge() {
  const api = useComposer();
  const view = useComposerView();
  const key = keyOf(api.scope);
  useEffect(() => {
    live.set(key, { api, view });
    emit();
  }, [key, api, view]);
  useEffect(
    () => () => {
      if (live.get(key)?.api === api) {
        live.delete(key);
        emit();
      }
    },
    [key, api],
  );
  return null;
}

/** The composer for a chat (threadId) or the new-thread screen (null), once it has mounted. */
export function useComposerHandle(threadId: string | null): ComposerHandle | null {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return live.get(threadId ? `thread:${threadId}` : "new") ?? null;
}
