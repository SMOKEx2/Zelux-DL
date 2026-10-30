import { useState } from "react";
import { Checkbox } from "../components/Controls";
import { FileTile } from "../components/Visuals";
import { WindowFrame } from "../components/WindowFrame";
import { Icon } from "../design/icons";
import { patchSettings } from "../lib/actions";
import { api } from "../lib/api";
import { formatBytes, formatDuration, formatSpeed } from "../lib/format";
import { t } from "../lib/i18n";
import { completionDetails } from "../lib/completion";
import { useApp } from "../lib/store";
import { attempt, toast } from "../lib/ui";
import { copyText, win } from "../lib/win";

export default function CompleteWindow({ id }: { id: string }) {
  const items = useApp((s) => s.items);
  const item = items[id];
  const [dontShow, setDontShow] = useState(false);

  const close = async () => {
    if (dontShow) await patchSettings({ general: { showCompletionDialog: false } });
    await win.close();
  };
  const run = async (p: Promise<void>, fail: string) => {
    await attempt(p, fail);
    await close();
  };

  const details = item ? completionDetails(item, Object.values(items)) : null;
  const took = details?.took;
  const size = details?.size ?? 0;
  const path = details?.path ?? "";
  const openFolder = () => details?.grouped ? api.openPath(path) : api.revealItem(id);

  return (
    <WindowFrame kind="complete" title={details?.allSkipped ? t("Already downloaded") : t("Download complete")} onClose={() => void close()} className="complete">
      <div className="complete__top">
        <div className="burst">
          <span>
            <Icon name="check" size={28} strokeWidth={2} />
          </span>
        </div>
        <div className="complete__txt">
          <h2 className="ellipsis" title={details?.name}>
            {details?.name ?? t("Download complete")}
          </h2>
          <div className="meta tnum">
            {!details?.allSkipped && formatBytes(size)}
            {details && details.skipped > 0 ? `${details.allSkipped ? "" : " · "}${t("{count} duplicate files skipped", { count: details.skipped })}` : ""}
            {!details?.allSkipped && took && took > 0 ? ` · ${t("finished in {duration} · average {speed}", { duration: formatDuration(took), speed: formatSpeed(size / took) })}` : ""}
          </div>
        </div>
      </div>
      {item && (
        <div className="complete__path">
          {details?.grouped ? <Icon name="folder-open" size={24} /> : <FileTile item={item} size={24} thumbWidth={36} />}
          <span className="t-mono ellipsis selectable" title={path}>
            {path}
          </span>
        </div>
      )}
      <footer className="dialog__footer">
        <Checkbox checked={dontShow} onChange={setDontShow}>
          {t("Don’t show again")}
        </Checkbox>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn--icon"
          aria-label={t("Copy path")}
          data-tip={t("Copy path")}
          disabled={!item}
          onClick={async () => {
            if (await copyText(path)) toast(t("Path copied"), { kind: "success", ms: 1500 });
          }}
        >
          <Icon name="copy" size={15} />
        </button>
        <button type="button" className="btn" disabled={!item} onClick={() => void run(openFolder(), t("Could not open the folder"))}>
          <Icon name="folder-open" size={15} /> {t("Open folder")}
        </button>
        <button type="button" className="btn btn--primary" autoFocus disabled={!item} onClick={() => void run(details?.grouped ? api.openPath(path) : api.openItem(id), t("Could not open the file"))}>
          <Icon name="open-file" size={15} /> {t("Open")}
        </button>
      </footer>
    </WindowFrame>
  );
}
