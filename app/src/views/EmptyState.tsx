import { Icon, type IconName } from "../design/icons";
import { actions } from "../lib/actions";
import { t } from "../lib/i18n";
import { useApp } from "../lib/store";
import { useUi } from "../lib/ui";

/** Friendly empty state for each view (and for searches / filters with no match). */
export function EmptyState() {
  const view = useApp((s) => s.view);
  const search = useApp((s) => s.search.trim());
  const duplicateScanStatus = useApp((s) => s.duplicateScanStatus);
  const filter = useUi((s) => s.filter);
  const queueName = useApp((s) => (s.view.kind === "queue" ? s.queues.find((q) => q.id === (s.view as { id: string }).id)?.name : undefined));

  let icon: IconName = "download";
  let title = t("No downloads yet");
  let text = t("Paste a link, drop one here, or let the browser extension hand downloads to Prism.");
  let cta: { label: string; run: () => void } | null = { label: t("Add URL"), run: actions.openAddUrl };

  if (search) {
    icon = "search";
    title = t("No matches for “{search}”", { search });
    text = t("Search looks at file names, addresses and descriptions.");
    cta = { label: t("Clear search"), run: () => useApp.getState().setSearch("") };
  } else if (view.kind === "duplicates") {
    icon = "copy";
    title = duplicateScanStatus === "scanning" ? t("Scanning duplicates…") : duplicateScanStatus === "error" ? t("Could not scan duplicate files") : duplicateScanStatus === "idle" ? t("Scan for duplicates") : t("No duplicate files found");
    text = t("Only completed files still present on disk are checked.");
    cta = null;
  } else if (filter !== "all") {
    icon = "filter";
    title = t("Nothing here with this filter");
    text = t("Switch the status filter back to All to see every download in this view.");
    cta = { label: t("Show all"), run: () => useUi.getState().setFilter("all") };
  } else if (view.kind === "trash") {
    icon = "trash";
    title = t("Trash is empty");
    text = t("Deleted downloads stay here until you empty the trash, so you can restore them.");
    cta = null;
  } else if (view.kind === "queue") {
    icon = "queue";
    title = queueName != null ? t("{queue} is empty", { queue: queueName }) : t("This queue is empty");
    text = t("Right-click downloads and choose Move to queue, or pick this queue in the Download File dialog.");
    cta = null;
  } else if (view.kind === "status" && view.id === "finished") {
    icon = "finished";
    title = t("Nothing finished yet");
    text = t("Completed downloads appear here.");
    cta = null;
  } else if (view.kind === "status" && view.id === "unfinished") {
    icon = "finished";
    title = t("All caught up");
    text = t("Every download has finished.");
    cta = null;
  } else if (view.kind === "category") {
    icon = "custom-folder";
    title = t("No downloads in this category");
    text = t("Files are sorted into categories by their extension.");
  } else if (view.kind === "grabber") {
    icon = "grabber-project";
    title = t("Nothing downloaded from this project");
    text = t("Open the project to pick files from the crawl results.");
    cta = { label: t("Open project"), run: () => useUi.getState().openSheet({ kind: "grabber", projectId: view.id }) };
  }

  return (
    <div className="empty" role="status">
      <span className="empty__icon">
        <Icon name={icon} size={26} strokeWidth={1.5} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {cta && (
        <button type="button" className="btn" onClick={cta.run}>
          {cta.label}
        </button>
      )}
    </div>
  );
}
