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
    icon: "music",
    title: tk("YouTube music playlists"),
    body: tk("Paste playlist links in the extension. Mix playlists default to 200 songs; creator playlists download all songs into a separate folder with one completion notice."),
  },
  {
    icon: "settings",
    title: tk("gallery-dl tool status"),
    body: tk("View gallery-dl below ffmpeg and adjust the YouTube Mix limit below Audio format in Video & streams settings."),
  },
  {
    icon: "folder-open",
    title: tk("Social post folders and duplicate skips"),
    body: tk("Posts from Facebook, Instagram, and X are grouped into a folder named for the site and post time; single images stay in the main folder. Duplicate post images are skipped and reported."),
  },
  {
    icon: "images",
    title: tk("Image previews and smoother selection"),
    body: tk("Completed images now show thumbnails in the download list. Select multiple downloads at once; the details pane adjusts with a smooth open and close."),
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
          <h2>{t("ZeluxDL {version} is here", { version })}</h2>
          <p className="text-secondary">{t("Post folders, duplicate checks, and image previews.")}</p>
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
