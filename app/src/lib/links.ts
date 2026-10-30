// Web links: opened in the user's browser (a new tab in the browser preview).

import { inTauri } from "./api";

/** ZeluxDL on GitHub. */
export const REPO_URL = "https://github.com/SMOKEx2/Zelux-DL";

export async function openUrl(url: string) {
  if (inTauri) {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
