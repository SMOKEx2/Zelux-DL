import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import { t } from "../lib/i18n";
import { matchesFilter } from "../lib/present";
import { type AppState, useApp, visibleItems } from "../lib/store";
import { type StatusFilter, useUi } from "../lib/ui";

/** Ordered ids for the sidebar view + title-row status filter + search. */
export function listIds(s: AppState, filter: StatusFilter): string[] {
  const list = visibleItems(s);
  return (filter === "all" ? list : list.filter((i) => matchesFilter(s.progress[i.id]?.status ?? i.status, filter))).map((i) => i.id);
}

/** Same as listIds, re-rendering only when the ordered list actually changes. */
export function useVisibleIds(): string[] {
  const filter = useUi((s) => s.filter);
  const selector = useMemo(() => {
    let previous: AppState | undefined;
    let result: string[] = [];
    return (state: AppState) => {
      const liveOrder = filter !== "all" || ["progress", "speed", "eta"].includes(state.sort.key);
      if (!previous || state.items !== previous.items || state.view !== previous.view
        || state.search !== previous.search || state.sort !== previous.sort
        || state.duplicateIds !== previous.duplicateIds
        || (liveOrder && state.progress !== previous.progress)) {
        result = listIds(state, filter);
      }
      previous = state;
      return result;
    };
  }, [filter]);
  return useApp(useShallow(selector));
}

/** Title for the current sidebar view. */
export function useViewTitle(): string {
  return useApp((s) => {
    const v = s.view;
    switch (v.kind) {
      case "duplicates":
        return t("Duplicates");
      case "all":
        return t("All downloads");
      case "trash":
        return t("Trash");
      case "status":
        return { unfinished: t("Unfinished"), finished: t("Finished"), active: t("Active"), failed: t("Failed") }[v.id];
      case "category":
        return s.categories.find((c) => c.id === v.id)?.name ?? t("Category");
      case "queue":
        return s.queues.find((q) => q.id === v.id)?.name ?? t("Queue");
      case "grabber":
        return s.grabberProjects.find((g) => g.id === v.id)?.name ?? t("Grabber project");
    }
  });
}
