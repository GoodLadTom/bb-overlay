// Start a real bb chat from a Home card: same project lookup and navigation as the Ask box.
import { useMemo, useState } from "react";
import { experimental_useSidebarThreads as useSidebarThreads, useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useWhere } from "./where";

export const PROVIDER_ID = { claude: "claude-code", codex: "codex", cursor: "acp-cursor" } as const;

/**
 * Every chat the plugin starts runs in Full access, never Auto, so a chat started from
 * Home, Inbox or the Agents panel does not stop to ask for permission.
 * The fields we choose are marked "explicit" so the server keeps them instead of
 * re-deriving them from the project's remembered defaults.
 */
export function fullAccess<T extends Record<string, unknown>>(args: T) {
  const sources: Record<string, "explicit"> = { permissionMode: "explicit" };
  for (const k of ["providerId", "model", "reasoningLevel", "serviceTier"]) if (args[k] !== undefined) sources[k] = "explicit";
  return { ...args, permissionMode: "full" as const, executionInputSources: sources };
}

/**
 * The project new work starts in. Without storage at home: the personal workspace, else the
 * first project. With it: the storage project at home, and away (or until we know) the
 * local-copy project, because starting a chat on a share over a slow VPN hangs.
 */
export function useWorkProject() {
  const { projects } = useSidebarThreads();
  const where = useWhere();
  return useMemo(() => {
    const named = (n: string) => (n ? projects.find((p) => p.name === n) : undefined);
    const fallback = projects.find((p) => p.id === "proj_personal") ?? projects[0];
    if (!where?.enabled) return fallback;
    const home = named(where.homeProject);
    const away = named(where.awayProject);
    return where.mode === "home" ? home ?? away ?? fallback : away ?? home ?? fallback;
  }, [projects, where]);
}

export function useSpawn() {
  const sdk = useSdk();
  const nav = useBbNavigate();
  const project = useWorkProject();
  const [busy, setBusy] = useState<string | null>(null);

  const spawn = async (key: string, title: string, prompt: string, providerId: string = PROVIDER_ID.claude) => {
    if (!project || busy) return false;
    setBusy(key);
    try {
      const made = await sdk.threads.spawn(
        fullAccess({
          projectId: project.id,
          environment: { type: "project-default" },
          providerId,
          title: title.slice(0, 80),
          visibility: "visible",
          prompt,
        }) as Parameters<typeof sdk.threads.spawn>[0],
      );
      nav.toThread((made as { id: string }).id);
      return true;
    } catch (e) {
      toast.error("Could not start the chat", { description: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { spawn, busy, ready: !!project, projectName: project?.name ?? null };
}
