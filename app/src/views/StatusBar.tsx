import { useEffect, useMemo, useState } from "react";
import { Icon } from "../design/icons";
import { actions } from "../lib/actions";
import { api } from "../lib/api";
import { formatBytes, formatSpeed } from "../lib/format";
import { t, tr } from "../lib/i18n";
import { displayName } from "../lib/present";
import { isActive, useApp } from "../lib/store";
import { useUi } from "../lib/ui";

/** Glass status bar overlaying the bottom of the list. */
export function StatusBar() {
  const speed = useApp((s) => Object.values(s.progress).reduce((sum, p) => sum + (p.speed || 0), 0));
  const items = useApp((s) => s.items);
  const queues = useApp((s) => s.queues);
  const limiter = useApp((s) => s.settings?.downloads.speedLimiterEnabled ?? false);
  const limit = useApp((s) => s.settings?.downloads.speedLimit ?? 0);
  const dir = useApp((s) => s.settings?.downloads.defaultDir ?? "");
  const bottomOpen = useUi((s) => s.bottomOpen);
  const [free, setFree] = useState<number | null>(null);
  const [next, setNext] = useState<[string, string | null][]>([]);
  const [integrationOk, setIntegrationOk] = useState<boolean | null>(null);

  const c = useMemo(() => {
    let active = 0;
    let queued = 0;
    for (const i of Object.values(items)) {
      if (i.trashed) continue;
      if (isActive(i.status)) active++;
      else if (i.status === "queued") queued++;
    }
    return { active, queued };
  }, [items]);

  useEffect(() => {
    if (!dir) return;
    const load = () => {
      void api.freeSpace(dir).then(setFree, () => setFree(null));
      void api.nextScheduleRuns().then(setNext, () => setNext([]));
      void api.integrationStatus().then((s) => setIntegrationOk(!!s.extensionConnected || s.browsers.some((b) => b.registered)), () => setIntegrationOk(null));
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [dir, queues]);

  const running = queues.filter((q) => q.running);
  const upcoming = next.find(([, at]) => at);
  const upcomingQueue = upcoming && queues.find((q) => q.id === upcoming[0]);

  return (
    <footer className="statusbar glass blur-md edge-top">
      <span className={`sb down${speed > 0 ? " is-active" : ""}`} data-tip={t("Total download speed")}>
        <Icon name="arrow-down" size={12} strokeWidth={2.2} />
        <b>{speed ? formatSpeed(speed) : "0 B/s"}</b>
        {speed > 0 && (
          <span className="speed-hud" aria-hidden="true">
            <span className="speed-hud__bar speed-hud__bar--1" />
            <span className="speed-hud__bar speed-hud__bar--2" />
            <span className="speed-hud__bar speed-hud__bar--3" />
            <span className="speed-hud__bar speed-hud__bar--4" />
          </span>
        )}
      </span>
      <span className="sb">{tr("{active} active · {queued} queued", { active: <b>{c.active}</b>, queued: <b>{c.queued}</b> })}</span>
      {running.length > 0 && (
        <span className="sb">
          <Icon name="queue" size={12} strokeWidth={2} />
          {t("{queues} running", { queues: running.map((q) => displayName(q.name)).join(", ") })}
        </span>
      )}
      {upcoming && upcomingQueue && (
        <span className="sb" data-tip={t("Next scheduled start")}>
          <Icon name="status-scheduled" size={12} strokeWidth={2} />
          {tr("{queue} at {time}", { queue: upcomingQueue.name, time: <b>{upcoming[1]?.slice(-5)}</b> })}
        </span>
      )}
      <span className="spacer" />
      <button type="button" className="sb sb--btn" onClick={() => void actions.toggleLimiter()} data-tip={t("Toggle speed limiter")} data-kbd="Ctrl L">
        <Icon name="speed-limiter" size={12} strokeWidth={2} />
        {tr("Limit {value}", { value: <b>{limiter ? `${formatBytes(limit)}/s` : t("Off")}</b> })}
      </button>
      {free != null && (
        <span className="sb" data-tip={dir}>
          <Icon name="hard-drive" size={12} strokeWidth={2} />
          {tr("{size} free", { size: <b>{formatBytes(free)}</b> })}
        </span>
      )}
      <button type="button" className={`sb sb--btn ${integrationOk ? "ok" : "warn"}`} onClick={() => useUi.getState().openSheet({ kind: "settings", section: "browser" })}>
        <Icon name={integrationOk ? "shield" : "warning"} size={12} strokeWidth={2} />
        {integrationOk ? t("Integration OK") : t("Integration !")}
      </button>
      <button
        type="button"
        className="sb sb--btn"
        aria-label={bottomOpen ? t("Hide details pane") : t("Show details pane")}
        data-tip={bottomOpen ? t("Hide details pane") : t("Show details pane")}
        onClick={() => useUi.getState().setBottom({ bottomOpen: !bottomOpen })}
      >
        <Icon name={bottomOpen ? "chevron-down" : "chevron-up"} size={13} strokeWidth={2} />
      </button>
    </footer>
  );
}
