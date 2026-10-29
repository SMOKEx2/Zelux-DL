import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { create } from "zustand";
import { Icon } from "../design/icons";
import { api, inTauri, onAppEvent, type UpdateInfo } from "../lib/api";
import { t } from "../lib/i18n";
import { openUrl, REPO_URL } from "../lib/links";
import { useApp } from "../lib/store";
import { toast } from "../lib/ui";
import { scheduleUpdateChecks, windowEnv } from "../lib/update-schedule";

const SITE = `${REPO_URL}/releases/latest`;
const RELEASES = `${REPO_URL}/releases`;

interface UpdateState {
  info: UpdateInfo | null;
  /** Version the user postponed this session. */
  later: string | null;
  phase: "idle" | "downloading" | "installing";
  progress: number;
}

const useUpdate = create<UpdateState>(() => ({ info: null, later: null, phase: "idle", progress: 0 }));

// "Later" lasts until Prism quits, also when the main window is created again after a while in
// the tray (it is closed there to free memory), so it is kept with this run's id.
const LATER_KEY = "prism.updateLater";

function postpone(version: string) {
  useUpdate.setState({ later: version });
  void api
    .appRunId()
    .then((run) => localStorage.setItem(LATER_KEY, JSON.stringify({ run, version })))
    .catch(() => {});
}

if (inTauri) {
  void api
    .appRunId()
    .then((run) => {
      const saved = JSON.parse(localStorage.getItem(LATER_KEY) ?? "null") as { run?: number; version?: string } | null;
      if (saved?.run === run && saved.version && !useUpdate.getState().later) useUpdate.setState({ later: saved.version });
    })
    .catch(() => {});
}

/** When the latest check started (counted from the app's start until the first one). */
let lastCheckAt = Date.now();

/** Looks for a newer release; `manual` reports "up to date" and errors as toasts. */
export async function checkForUpdates(manual = false): Promise<void> {
  lastCheckAt = Date.now();
  try {
    const info = await api.checkUpdate();
    useUpdate.setState({ info, ...(manual ? { later: null } : {}) });
    if (manual) {
      try {
        localStorage.removeItem(LATER_KEY);
      } catch {
        /* storage unavailable */
      }
    }
    if (manual && !info) toast(t("ZeluxDL is up to date"), { kind: "success", ms: 2500 });
  } catch (e) {
    if (manual) toast(t("Couldn't check for updates"), { kind: "error", body: String(e) });
  }
}

async function install() {
  useUpdate.setState({ phase: "downloading", progress: 0 });
  const off = await onAppEvent<[number, number | null]>("update-progress", ([got, total]) => {
    useUpdate.setState({ progress: total ? got / total : 0, phase: total && got >= total ? "installing" : "downloading" });
  });
  try {
    await api.installUpdate(); // on success the app restarts and never gets here
  } catch (e) {
    toast(t("The update couldn't be installed"), { kind: "error", body: String(e) });
    useUpdate.setState({ phase: "idle" });
  } finally {
    off();
  }
}

/** "Prism x.y.z is ready — Restart & update" bar above the download list. */
export function UpdateBanner() {
  const enabled = useApp((s) => s.settings?.general.checkUpdates ?? true);
  const { info, later, phase, progress } = useUpdate();

  useEffect(() => {
    if (!enabled) return;
    // 5 s after start, every hour, and on coming back to the window after 30 min.
    return scheduleUpdateChecks(() => void checkForUpdates(), () => lastCheckAt, windowEnv);
  }, [enabled]);

  const show = !!info && later !== info.version;
  const busy = phase !== "idle";
  return (
    <div className="cbanner-slot">
      <AnimatePresence initial={false}>
        {show && info && (
          <motion.div className="cbanner" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <div className="cbanner__inner ubanner">
              <span className="cbanner__icon">
                <Icon name="download" size={16} />
              </span>
              <span className="cbanner__txt">
                {busy ? (
                  <>
                    <b>
                      {phase === "installing"
                        ? t("Installing ZeluxDL {version}…", { version: info.version })
                        : t("Downloading ZeluxDL {version}… {percent}%", { version: info.version, percent: Math.round(progress * 100) })}
                    </b>{" "}
                    {t("ZeluxDL restarts by itself and your downloads continue.")}
                    <span className="ubanner__bar">
                      <span style={{ width: `${Math.max(4, progress * 100)}%` }} />
                    </span>
                  </>
                ) : (
                  <>
                    <b>{t("ZeluxDL {version} is ready.", { version: info.version })}</b> {t("You have {version}.", { version: info.current })}{" "}
                    <button type="button" className="link-btn" onClick={() => void openUrl(`${RELEASES}/tag/v${info.version}`)}>
                      {t("What’s new")}
                    </button>
                  </>
                )}
              </span>
              {!busy &&
                (info.canInstall ? (
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => void install()}>
                    {t("Restart & update")}
                  </button>
                ) : (
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => void openUrl(SITE)}>
                    {t("Get the update")}
                  </button>
                ))}
              {!busy && (
                <button type="button" className="tb-btn" aria-label={t("Remind me later")} data-tip={t("Later")} onClick={() => postpone(info.version)}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
