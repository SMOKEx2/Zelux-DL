import { useEffect } from "react";
import { BrandTile } from "../../components/LogoMark";
import { Icon, type IconName } from "../../design/icons";
import { patchSettings } from "../../lib/actions";
import { api } from "../../lib/api";
import { t, tk } from "../../lib/i18n";
import { openUrl, REPO_URL } from "../../lib/links";
import { useApp } from "../../lib/store";
import { useUi } from "../../lib/ui";
import { versionNewer } from "../../lib/version";
import { BrowserConnect, useExtensionStatus } from "../BrowserConnect";

type Change = { icon: IconName; title: string; body: string; credit?: string; action?: "sounds" | "language" | "appearance" | "model" | "downloads" };

/**
 * Current ZeluxDL release notes, shown after an update and from About. Titles and bodies are
 * translated where they're shown; `credit` is the contributor's handle.
 */
const CHANGES: Change[] = [
  {
    icon: "bolt",
    title: tk("Turbo Multi-Thread Booster"),
    body: tk("ZeluxDL gradually adds more connections during a healthy download, up to the configured limit."),
    action: "downloads",
  },
  {
    icon: "star",
    title: tk("ZeluxDL branding and source credit"),
    body: tk("The About page now credits the upstream project directly; the rest of the app uses ZeluxDL branding."),
  },
];

/**
 * "What's new" after an update: current release changes and the live browser integration status.
 */
export function WhatsNewSheet() {
  const version = useApp((s) => s.version);
  const { status, connected } = useExtensionStatus();
  return (
    <div className="whatsnew">
      <header className="whatsnew__head">
        <BrandTile size={52} />
        <div>
          <h2>{t("Prism {version} is here", { version })}</h2>
          <p className="text-secondary">{t("Turbo connection scaling and updated browser setup.")}</p>
        </div>
      </header>

      <section className="whatsnew__store card">
        <div className="whatsnew__storehead">
          <Icon name="puzzle" size={18} className="text-accent" />
          <div>
            <b>{t("Browser integration")}</b>
          </div>
        </div>
        <BrowserConnect status={status} connected={connected} />
      </section>

      <ChangeList changes={CHANGES} />
      <p className="whatsnew__star t-small text-secondary">
        <Icon name="star" size={14} className="text-accent" />
        <span>
          {t("Enjoying Prism? A star on GitHub helps more people find it.")}{" "}
          <button type="button" className="linkbtn" onClick={() => void openUrl(REPO_URL)}>
            {t("Star on GitHub")}
          </button>
        </span>
      </p>
    </div>
  );
}

function ChangeList({ changes }: { changes: Change[] }) {
  const openSheet = useUi((s) => s.openSheet);
  return (
    <ul className="whatsnew__list">
      {changes.map((c) => (
        <li key={c.title}>
          <span className="whatsnew__icon">
            <Icon name={c.icon} size={16} />
          </span>
          <div>
            <b>{t(c.title)}</b>
            <div className="t-small text-secondary">
              {t(c.body)}
              {c.credit && ` ${t("Thanks to {name}!", { name: c.credit })}`}{" "}
              {c.action === "sounds" && (
                <button type="button" className="linkbtn" onClick={() => openSheet({ kind: "settings", section: "sounds" })}>
                  {t("Try them")}
                </button>
              )}
              {c.action === "appearance" && (
                <button type="button" className="linkbtn" onClick={() => openSheet({ kind: "settings", section: "appearance" })}>
                  {t("Try it")}
                </button>
              )}
              {c.action === "model" && (
                <button type="button" className="linkbtn" onClick={() => void api.openWindow("model")}>
                  {t("Try it")}
                </button>
              )}
              {c.action === "language" && (
                <button type="button" className="linkbtn" onClick={() => openSheet({ kind: "settings", section: "general" })}>
                  {t("Choose a language")}
                </button>
              )}
              {c.action === "downloads" && (
                <button type="button" className="linkbtn" onClick={() => openSheet({ kind: "settings", section: "downloads" })}>
                  {t("Try it")}
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Opens "What's new" once after Prism was updated, when the main window is on screen (not while
 * it starts hidden in the tray). A fresh install shows the onboarding instead and only records
 * the version.
 */
export function useWhatsNew() {
  const version = useApp((s) => s.version);
  const seen = useApp((s) => s.settings?.lastSeenVersion);
  const onboarded = useApp((s) => s.settings?.onboardingDone);
  useEffect(() => {
    if (!version || seen === undefined || onboarded === undefined || seen === version) return;
    if (!onboarded || (seen && !versionNewer(version, seen))) {
      void patchSettings({ lastSeenVersion: version });
      return;
    }
    const show = () => {
      if (document.visibilityState !== "visible") return false;
      if (!useUi.getState().sheet) useUi.getState().openSheet({ kind: "whatsnew" });
      void patchSettings({ lastSeenVersion: version });
      return true;
    };
    if (show()) return;
    const onVisible = () => {
      if (show()) document.removeEventListener("visibilitychange", onVisible);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [version, seen, onboarded]);
}
