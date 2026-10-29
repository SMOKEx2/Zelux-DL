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

type Change = { icon: IconName; title: string; body: string; credit?: string; action?: "sounds" | "language" | "appearance" | "model" };

/**
 * What this version brings (shown once after an update, and from About Prism), then what the
 * version before brought, for people updating from older ones. Titles and bodies are translated
 * where they're shown; `credit` is the contributor's handle.
 */
const CHANGES: Change[] = [
  {
    icon: "model",
    title: tk("AI models from Hugging Face"),
    body: tk("Download a model by its name, a link or a search. Prism picks the files you need (one GGUF version, the weights in one format) and downloads them over many connections, checked against Hugging Face."),
    credit: "Vasili-Sk",
    action: "model",
  },
  {
    icon: "globe",
    title: tk("Turkish"),
    body: tk("Prism now speaks Turkish too."),
    action: "language",
  },
  {
    icon: "monitor",
    title: tk("Windows on Linux"),
    body: tk("On KDE Plasma, Prism's windows no longer sometimes open empty."),
  },
  {
    icon: "sun",
    title: tk("Background that matches the theme"),
    body: tk("On Linux the window no longer shows the desktop through it, and on Windows the glass switches too when Windows changes between light and dark."),
  },
];

/** The previous version's changes, shown below the new ones. */
const PREVIOUS = { version: "1.1.6", changes: [
  {
    icon: "sun",
    title: tk("Light theme"),
    body: tk("When the theme matches Windows, the glass behind the window is now light in the light theme too."),
  },
  {
    icon: "browser",
    title: tk("Brave Origin"),
    body: tk("The browser extension now connects in Brave Origin too."),
  },
  {
    icon: "video",
    title: tk("VK and YouTube videos"),
    body: tk("The Download video button works on vk.ru and vkvideo.ru, and videos from a browser signed in to YouTube no longer fail."),
    credit: "BiparJoy",
  },
] satisfies Change[] };

/**
 * "What's new" after an update: the browser extension from the Chrome Web Store first (one
 * click, updates itself; replaces one added by hand), then what else changed.
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
          <p className="text-secondary">{t("AI models from Hugging Face, Turkish, and a fix for Linux.")}</p>
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
      <h3 className="whatsnew__older t-small text-tertiary">{t("New in Prism {version}", { version: PREVIOUS.version })}</h3>
      <ChangeList changes={PREVIOUS.changes} />
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
