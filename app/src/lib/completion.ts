import type { DownloadItem } from "./types";
import { fullPath } from "./paths";

export function completionDetails(item: DownloadItem, items: DownloadItem[]) {
  const group = item.media?.downloadGroup;
  const members = group ? items.filter((entry) => entry.media?.downloadGroup === group && !entry.trashed) : [item];
  const saved = members.filter((entry) => !entry.media?.duplicateOf);
  const representative = saved[0] ?? item;
  const grouped = !!group && saved.length > 0;
  const starts = members.flatMap((entry) => entry.lastTryAt == null ? [] : [entry.lastTryAt]);
  const finishes = members.flatMap((entry) => entry.finishedAt == null ? [] : [entry.finishedAt]);
  return {
    grouped,
    name: grouped ? representative.saveDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop()! : representative.fileName,
    path: grouped ? representative.saveDir : fullPath(representative.saveDir, representative.fileName),
    size: saved.reduce((sum, entry) => sum + (entry.size ?? entry.downloaded), 0),
    skipped: members.length - saved.length,
    allSkipped: saved.length === 0,
    took: starts.length && finishes.length ? (Math.max(...finishes) - Math.min(...starts)) / 1000 : null,
  };
}
