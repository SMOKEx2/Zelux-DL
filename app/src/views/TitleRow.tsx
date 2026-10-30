import { useMemo } from "react";
import { Segmented } from "../components/Controls";
import { IconButton } from "../components/IconButton";
import { openMenuAt } from "../components/MenuHost";
import { Icon } from "../design/icons";
import { patchSettings } from "../lib/actions";
import { api } from "../lib/api";
import { COLUMNS, toggleColumn, type ColumnKey } from "../lib/columns";
import { formatBytes } from "../lib/format";
import { t } from "../lib/i18n";
import { isActive, useApp } from "../lib/store";
import { matchesFilter } from "../lib/present";
import { attempt, type StatusFilter, useUi } from "../lib/ui";
import { useViewTitle } from "./useListing";

export function TitleRow() {
  const title = useViewTitle();
  const view = useApp((s) => s.view);
  const items = useApp((s) => s.items);
  const duplicateIds = useApp((s) => s.duplicateIds);
  const filter = useUi((s) => s.filter);
  const queues = useApp((s) => s.queues);
  const density = useApp((s) => s.settings?.appearance.density ?? "comfortable");
  const duplicateScanStatus = useApp((s) => s.duplicateScanStatus);

  // Counts for the segmented filter within the current view (search ignored on purpose).
  const stats = useMemo(() => {
    const st = useApp.getState();
    const scoped = Object.values(items).filter((i) => {
      if (view.kind === "trash") return i.trashed;
      if (i.trashed) return false;
      if (view.kind === "duplicates") return duplicateIds.includes(i.id);
      if (view.kind === "category") return i.category === view.id;
      if (view.kind === "queue") return i.queueId === view.id;
      if (view.kind === "grabber") return i.grabberProject === view.id;
      if (view.kind === "status") return view.id === "finished" ? i.status === "completed" : view.id === "unfinished" ? i.status !== "completed" : true;
      return true;
    });
    const f = (k: StatusFilter) => scoped.filter((i) => matchesFilter(st.progress[i.id]?.status ?? i.status, k)).length;
    return {
      total: scoped.length,
      active: scoped.filter((i) => isActive(i.status)).length,
      bytes: scoped.reduce((sum, i) => sum + (i.size ?? 0), 0),
      byFilter: { all: scoped.length, active: f("active"), queued: f("queued"), completed: f("completed"), failed: f("failed") },
    };
  }, [items, view, duplicateIds]);

  const queue = view.kind === "queue" ? queues.find((q) => q.id === view.id) : undefined;
  const columns = () => {
    const visible = useApp.getState().settings?.appearance.visibleColumns ?? [];
    return COLUMNS.filter((c) => c.key !== "name").map((c) => ({
      label: t(c.label),
      checked: visible.includes(c.key),
      onSelect: () => void patchSettings({ appearance: { visibleColumns: toggleColumn(visible, c.key as ColumnKey) } }),
    }));
  };

  return (
    <div className="titlerow">
      <div className="titlerow__text">
        <h1>{title}</h1>
        <div className="sub tnum">
          {t("{count} items", { count: stats.total })}
          {stats.active > 0 && ` · ${t("{count} downloading", { count: stats.active })}`}
          {stats.bytes > 0 && ` · ${t("{size} total", { size: formatBytes(stats.bytes) })}`}
        </div>
      </div>
      {queue && (
        <div className="titlerow__actions">
          {queue.running ? (
            <button type="button" className="btn btn--sm" onClick={() => void attempt(api.stopQueue(queue.id))}>
              <Icon name="stop-queue" size={15} /> {t("Stop queue")}
            </button>
          ) : (
            <button type="button" className="btn btn--sm" onClick={() => void attempt(api.startQueue(queue.id))}>
              <Icon name="start-queue" size={15} /> {t("Start queue")}
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => useUi.getState().openSheet({ kind: "scheduler", queueId: queue.id })}>
            <Icon name="scheduler" size={15} /> {t("Schedule")}
          </button>
        </div>
      )}
      {view.kind === "trash" && stats.total > 0 && (
        <button type="button" className="btn btn--sm btn--danger" onClick={() => void attempt(api.emptyTrash(), t("Could not empty the trash"))}>
          <Icon name="delete" size={15} /> {t("Empty trash")}
        </button>
      )}
      {view.kind === "duplicates" && (
        <button type="button" className="btn btn--sm" disabled={duplicateScanStatus === "scanning"} onClick={() => void attempt(useApp.getState().scanDuplicates(), t("Could not scan duplicate files"))}>
          <Icon name="refresh-url" size={15} /> {duplicateScanStatus === "scanning" ? t("Scanning duplicates…") : t("Scan again")}
        </button>
      )}
      {view.kind === "grabber" && (
        <button type="button" className="btn btn--sm" onClick={() => useUi.getState().openSheet({ kind: "grabber", projectId: view.id })}>
          <Icon name="grabber" size={15} /> {t("Open project")}
        </button>
      )}
      <span className="spacer" />
      <Segmented<StatusFilter>
        label={t("Filter by status")}
        value={filter}
        onChange={(f) => useUi.getState().setFilter(f)}
        options={[
          { value: "all", label: t("All"), count: stats.byFilter.all },
          { value: "active", label: t("Active"), count: stats.byFilter.active },
          { value: "queued", label: t("Waiting"), count: stats.byFilter.queued },
          { value: "completed", label: t("Completed"), count: stats.byFilter.completed },
          { value: "failed", label: t("Failed"), count: stats.byFilter.failed },
        ]}
      />
      <IconButton
        variant="button"
        icon={density === "compact" ? "list" : "grid"}
        size={16}
        label={density === "compact" ? t("Comfortable rows") : t("Compact rows")}
        onClick={() => void patchSettings({ appearance: { density: density === "compact" ? "comfortable" : "compact" } })}
      />
      <IconButton variant="button" icon="columns" size={16} label={t("Columns")} onClick={(e) => openMenuAt(e.currentTarget, [{ heading: t("Visible columns") }, ...columns()])} />
    </div>
  );
}
