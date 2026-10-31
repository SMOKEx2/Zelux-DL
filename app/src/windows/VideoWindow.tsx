import { useEffect, useMemo, useState } from "react";
import { Checkbox, Segmented, Switch, TextField } from "../components/Controls";
import { openMenuAt } from "../components/MenuHost";
import { WindowFrame } from "../components/WindowFrame";
import { Icon } from "../design/icons";
import { api, type PlaylistEntry, type VideoChoice, type VideoProbe } from "../lib/api";
import { formatBytes, formatClock, hostOf } from "../lib/format";
import { t, tk } from "../lib/i18n";
import { useApp } from "../lib/store";
import { displayName } from "../lib/present";
import { initialMediaSelection, isSinglePostMediaUrl, mediaSelectionKey } from "../lib/socialPost";
import type { SniffedStream, StartMode, VideoCapture } from "../lib/types";
import { attempt, toast } from "../lib/ui";
import { pickFolder, win } from "../lib/win";

type Sponsor = "off" | "mark" | "remove";

/** Quality presets applied to every entry of a playlist (the core resolves them per video). */
const preset = (id: string, kind: "video" | "audio", label: string, subLabel: string, extra: Partial<VideoChoice> = {}): VideoChoice => ({
  id,
  kind,
  label,
  subLabel,
  hdr: false,
  container: "mp4",
  accelerable: false,
  ...extra,
});

export const PLAYLIST_CHOICES: VideoChoice[] = [
  preset("best", "video", tk("Best available"), tk("Highest resolution per video")),
  preset("v1080", "video", "1080p", tk("or the closest below"), { height: 1080 }),
  preset("v720", "video", "720p", tk("smaller files"), { height: 720 }),
  preset("a-mp3", "audio", "MP3", "320 kbps", { audioFormat: "mp3", audioBitrateKbps: 320 }),
];

type Format = "mp4" | "mp3";

/** The simple model: MP4 at a chosen quality, or MP3 audio only. */
function splitChoices(all: VideoChoice[]): { video: VideoChoice[]; mp3: VideoChoice | undefined } {
  const seen = new Set<string>();
  const video = all.filter((c) => {
    if (c.kind !== "video") return false;
    const key = `${c.height ?? 0}-${Math.round(c.fps ?? 0)}-${c.hdr ? 1 : 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const mp3 = all.find((c) => c.kind === "audio" && c.audioFormat === "mp3") ?? all.find((c) => c.kind === "audio");
  return { video, mp3 };
}

export default function VideoWindow({ id }: { id: string }) {
  const settings = useApp((s) => s.settings);
  const [cap, setCap] = useState<VideoCapture | null>(null);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<string>("");
  const [format, setFormat] = useState<Format>("mp4");
  const [more, setMore] = useState(false);
  const [entries, setEntries] = useState<Set<string>>(new Set());
  const [subs, setSubs] = useState(settings?.video.embedSubtitles ?? false);
  const [langs, setLangs] = useState(settings?.video.subtitleLangs ?? "en.*");
  const [thumb, setThumb] = useState(settings?.video.embedThumbnail ?? true);
  const [meta, setMeta] = useState(settings?.video.embedMetadata ?? true);
  const [chapters, setChapters] = useState(settings?.video.embedChapters ?? true);
  const [sponsor, setSponsor] = useState<Sponsor>(settings?.video.sponsorblock ?? "off");
  const [dir, setDir] = useState("");
  const [oneByOne, setOneByOne] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usePostSession, setUsePostSession] = useState(false);
  // The container set in Settings › Video & streams (MP4, MKV or WebM).
  const container = (["mp4", "mkv", "webm"] as const).find((c) => c === settings?.video.container) ?? "mp4";
  const containerName = container === "webm" ? "WebM" : container.toUpperCase();

  useEffect(() => {
    void (async () => {
      const c = await attempt(api.getVideo(id), t("Could not load the video"));
      if (!c) return setError(t("This video request is no longer available."));
      setCap(c);
      try {
        const post = isSinglePostMediaUrl(c.pageUrl);
        const p = await api.probeVideo(c.pageUrl, post && !usePostSession ? undefined : c.cookies, c.userAgent);
        setProbe(p);
        if (p.kind === "video") {
          const pref = settings?.video.preferredHeight ?? 1080;
          const pick = p.choices.find((x) => x.kind === "video" && (x.height ?? 0) <= pref) ?? p.choices[0];
          setChoice((c.preselected && p.choices.some((x) => x.id === c.preselected) ? c.preselected : pick?.id) ?? "");
        } else {
          setChoice("v1080");
          if (new URL(c.pageUrl).hostname.endsWith("youtube.com") || new URL(c.pageUrl).hostname === "youtu.be") setFormat("mp3");
          setEntries(initialMediaSelection(p.entries.map((e, i) => mediaSelectionKey(e.url, i)), isSinglePostMediaUrl(c.pageUrl)));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id, settings?.video.preferredHeight, usePostSession]);

  const playlistAudioFormat = (["mp3", "m4a", "opus", "flac"] as const).find((value) => value === settings?.video.audioFormat) ?? "mp3";
  const audioName = probe?.kind === "playlist" ? playlistAudioFormat.toUpperCase() : "MP3";
  const choices = useMemo(() => probe?.kind === "video" ? probe.choices : PLAYLIST_CHOICES.map((c) => c.kind === "audio" ? { ...c, audioFormat: playlistAudioFormat, audioBitrateKbps: playlistAudioFormat === "mp3" ? 320 : undefined, label: audioName } : c), [probe, playlistAudioFormat, audioName]);
  const { video, mp3 } = useMemo(() => splitChoices(choices), [choices]);
  const picked = format === "mp3" ? mp3 : video.find((c) => c.id === choice) ?? video[0];
  const subLangs = useMemo(() => (probe?.kind === "video" ? Object.keys(probe.subtitles ?? {}) : []), [probe]);
  const named = (probe?.kind === "video" ? probe.title : probe?.kind === "playlist" ? probe.title : null) ?? cap?.title;
  // The English fallback goes to the core; only the shown one is translated.
  const title = named ?? "Video";
  const postMedia = isSinglePostMediaUrl(cap?.pageUrl ?? "");

  const confirm = async (mode: StartMode) => {
    if (!cap || !picked) return;
    setBusy(true);
    if (postMedia && probe?.kind === "playlist") {
      const selected = probe.entries.flatMap((entry, i) =>
        entries.has(mediaSelectionKey(entry.url, i))
          ? [{ url: entry.url, extension: entry.extension ?? "", httpHeaders: entry.httpHeaders ?? {}, index: i + 1 }]
          : [],
      );
      const count = await attempt(
        api.addPostMedia({ pageUrl: cap.pageUrl, media: selected, cookies: usePostSession ? cap.cookies ?? undefined : undefined, userAgent: cap.userAgent ?? undefined, saveDir: dir || undefined, mode }),
        t("Could not add the video"),
      );
      setBusy(false);
      if (count !== undefined) void win.close();
      return;
    }
    const info = probe?.kind === "video" ? probe : null;
    const n = await attempt(
      api.confirmVideo({
        captureId: cap.id,
        pageUrl: cap.pageUrl,
        choice: picked,
        options: {
          container,
          audioFormat: probe?.kind === "playlist" ? playlistAudioFormat : "mp3",
          embedSubtitles: subs,
          subLangs: langs.split(/[\s,]+/).filter(Boolean),
          embedThumbnail: thumb,
          embedMetadata: meta,
          embedChapters: chapters,
          sponsorblock: { mode: sponsor, categories: ["sponsor", "selfpromo", "interaction"] },
        },
        saveDir: dir || undefined,
        title,
        thumbnail: info?.thumbnail ?? undefined,
        duration: info?.duration ?? undefined,
        context: cap.cookies || cap.userAgent ? { cookies: cap.cookies ?? "", userAgent: cap.userAgent ?? "", referer: cap.pageUrl } : undefined,
        entries:
          probe?.kind === "playlist"
            ? probe.entries.flatMap((e, i) => (entries.has(mediaSelectionKey(e.url, i)) ? [{ url: e.url, title: e.title ?? null, index: i + 1 }] : []))
            : [],
        oneAtATime: probe?.kind === "playlist" && oneByOne,
        mode,
      }),
      t("Could not add the video"),
    );
    setBusy(false);
    if (n !== undefined) void win.close();
  };
  const canConfirm = !!picked && !busy && (probe?.kind !== "playlist" || entries.size > 0);
  const cancel = () => {
    if (cap) void api.cancelVideo(cap.id);
    void win.close();
  };

  return (
    <WindowFrame kind="video" title={t("Download video")} icon={<Icon name="video" size={17} className="text-accent" />} onClose={cancel} className="video">
      <div className="wbody">
        <div className="vhead">
          <span className="vthumb" style={probe?.kind === "video" && probe.thumbnail ? { backgroundImage: `url("${probe.thumbnail}")` } : undefined}>
            {probe?.kind === "video" && probe.duration ? <span className="thumb__dur">{formatClock(probe.duration)}</span> : null}
            {!probe && !error && <span className="vthumb__shimmer" />}
          </span>
          <div className="vhead__txt">
            <b>{named ?? t("Video")}</b>
            <small>
              {probe?.kind === "video"
                ? [probe.uploader ?? probe.channel, probe.isLive ? t("Live") : null, hostOf(cap?.pageUrl)].filter(Boolean).join(" · ")
                : probe?.kind === "playlist"
                  ? isSinglePostMediaUrl(cap?.pageUrl ?? "")
                    ? t("Post media · {count} items", { count: probe.entries.length })
                    : t("Playlist · {count} videos", { count: probe.entries.length })
                  : hostOf(cap?.pageUrl)}
            </small>
          </div>
        </div>

        {!probe && !error && (
          <div className="vloading">
            <Icon name="retry" size={15} className="anim-spin" /> {t("Reading available formats…")}
          </div>
        )}
        {error && (
          <div className="banner banner--warn">
            <Icon name="warning" size={16} />
            <div>
              <b>{t("Couldn’t read this page’s formats")}</b>
              <div className="t-small">{error}</div>
            </div>
          </div>
        )}

        {probe?.kind === "playlist" && <Playlist entries={probe.entries} checked={entries} onChange={setEntries} />}
        {postMedia && (
          <div className="vopt">
            <Checkbox checked={usePostSession} onChange={setUsePostSession}>
              {t("Use my browser session for this post")}
            </Checkbox>
            <small className="text-tertiary">{t("Only sent to this PC for this post; removed when its download ends.")}</small>
          </div>
        )}
        {probe?.kind === "playlist" && !postMedia && (
          <div className="vopt vopt--plist">
            <Checkbox checked={oneByOne} onChange={setOneByOne}>
              {t("One at a time")} <span className="text-tertiary">— {t("each video starts when the one before it is done")}</span>
            </Checkbox>
          </div>
        )}

        {probe && !postMedia && (
          <div className="vformat">
            <Segmented<Format>
              label={t("Format")}
              value={format}
              onChange={setFormat}
              options={[
                { value: "mp4", label: t("{format} video", { format: containerName }) },
                { value: "mp3", label: probe?.kind === "playlist" ? t("{format} audio", { format: audioName }) : t("MP3 audio") },
              ]}
            />
          </div>
        )}

        {probe && !postMedia && format === "mp4" && (
          <div className="choices" role="radiogroup" aria-label={t("Quality")}>
            <div className="qsec">{probe.kind === "playlist" ? t("Quality for every video") : t("Quality")}</div>
            {video.map((c) => (
              <ChoiceRow key={c.id} c={c} on={c.id === picked?.id} onPick={() => setChoice(c.id)} />
            ))}
          </div>
        )}
        {probe && !postMedia && format === "mp3" && mp3 && (
          <div className="choices" role="radiogroup" aria-label={t("Audio")}>
            <div className="qsec">{t("Audio only")}</div>
            <ChoiceRow c={{ ...mp3, label: audioName, subLabel: `${audioName === "MP3" ? "320 kbps" : audioName}${mp3.estSize ? ` · ~${formatBytes(mp3.estSize)}` : ""}` }} on onPick={() => undefined} />
          </div>
        )}

        {probe && (
          <div className="vopts">
            <div className="vopt">
              <span>
                <Icon name="folder" size={15} /> {t("Save to")}
              </span>
              <div className="withbtn">
                <TextField value={dir} onChange={setDir} label={t("Save folder")} placeholder={format === "mp3" ? t("Music folder (default)") : t("Video folder (default)")} />
                <button type="button" className="btn" onClick={async () => setDir((await pickFolder(dir)) ?? dir)}>
                  {t("Browse…")}
                </button>
              </div>
            </div>
            <button type="button" className="vmore" aria-expanded={more} onClick={() => setMore(!more)}>
              <Icon name={more ? "chevron-up" : "chevron-down"} size={14} /> {t("More options")}
            </button>
          </div>
        )}

        {probe && !postMedia && more && (
          <div className="vopts">
            <div className="vopt">
              <span>
                <Icon name="subtitle" size={15} /> {t("Subtitles")} {subLangs.length ? <em>({subLangs.slice(0, 6).join(", ")})</em> : null}
              </span>
              <div className="inline">
                {subs && <TextField value={langs} onChange={setLangs} label={t("Subtitle languages")} mono />}
                <Switch checked={subs} label={t("Embed subtitles")} onChange={setSubs} />
              </div>
            </div>
            <div className="vopt">
              <span>
                <Icon name="thumbnail" size={15} /> {t("Embed")}
              </span>
              <div className="inline">
                <Checkbox checked={thumb} onChange={setThumb}>
                  {t("Thumbnail")}
                </Checkbox>
                <Checkbox checked={meta} onChange={setMeta}>
                  {t("Metadata")}
                </Checkbox>
                <Checkbox checked={chapters} onChange={setChapters}>
                  {t("Chapters")}
                </Checkbox>
              </div>
            </div>
            <div className="vopt">
              <span>SponsorBlock</span>
              <Segmented<Sponsor>
                size="sm"
                label="SponsorBlock"
                value={sponsor}
                onChange={setSponsor}
                options={[
                  { value: "off", label: t("Off") },
                  { value: "mark", label: t("Mark") },
                  { value: "remove", label: t("Remove") },
                ]}
              />
            </div>
          </div>
        )}

        {cap && cap.streams.length > 0 && <Streams streams={cap.streams} pageUrl={cap.pageUrl} title={title} />}
      </div>
      <footer className="dialog__footer">
        <button type="button" className="btn btn--ghost" onClick={cancel}>
          {t("Cancel")}
        </button>
        <span className="spacer" />
        <div className="split">
          <button type="button" className="btn" disabled={!canConfirm} onClick={() => confirm({ type: "later" })}>
            {t("Later")}
          </button>
          <button
            type="button"
            className="btn"
            aria-label={t("Add to queue")}
            disabled={!canConfirm}
            onClick={(e) => openMenuAt(e.currentTarget, [{ heading: t("Add to queue") }, ...useApp.getState().queues.map((q) => ({ label: displayName(q.name), icon: "queue" as const, onSelect: () => void confirm({ type: "queue", queueId: q.id }) }))])}
          >
            <Icon name="chevron-down" size={13} strokeWidth={2.2} />
          </button>
        </div>
        <button type="button" className="btn btn--primary" disabled={!canConfirm} onClick={() => confirm({ type: "now" })}>
          <Icon name="download" size={15} />
          {probe?.kind === "playlist"
            ? format === "mp3"
              ? audioName === "MP3" ? t("Download {number} as MP3", { number: entries.size }) : t("Download {number} as {format}", { number: entries.size, format: audioName })
              : isSinglePostMediaUrl(cap?.pageUrl ?? "")
                ? t("Download {count} selected items", { count: entries.size })
                : t("Download {count} videos", { count: entries.size })
            : format === "mp3"
              ? t("Download MP3")
              : picked
                ? t("Download {quality} {format}", { quality: t(picked.label).split(" · ")[0], format: containerName })
                : t("Download")}
        </button>
      </footer>
    </WindowFrame>
  );
}

function ChoiceRow({ c, on, onPick }: { c: VideoChoice; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`qopt${on ? " on" : ""}`} onClick={onPick}>
      <span className="radio" />
      <span className="lbl">
        {t(c.label)}
        {c.hdr && <span className="badge badge--accent">HDR</span>}
        <em>{t(c.subLabel)}</em>
      </span>
      <span className="sz tnum">{c.estSize && !c.subLabel.includes("~") ? `~${formatBytes(c.estSize)}` : ""}</span>
    </button>
  );
}

function Playlist({ entries, checked, onChange }: { entries: PlaylistEntry[]; checked: Set<string>; onChange: (s: Set<string>) => void }) {
  const all = entries.every((e, i) => checked.has(mediaSelectionKey(e.url, i)));
  return (
    <div className="plist">
      <div className="plist__head">
        <Checkbox checked={all} indeterminate={!all && checked.size > 0} onChange={(v) => onChange(new Set(v ? entries.map((e, i) => mediaSelectionKey(e.url, i)) : []))}>
          {t("{count} of {total} selected", { count: checked.size, total: entries.length })}
        </Checkbox>
      </div>
      <div className="plist__rows">
        {entries.map((e, i) => (
          <div
            key={mediaSelectionKey(e.url, i)}
            className="plist__row"
            onClick={() => {
              const n = new Set(checked);
              const key = mediaSelectionKey(e.url, i);
              if (n.has(key)) n.delete(key);
              else n.add(key);
              onChange(n);
            }}
          >
            <Checkbox checked={checked.has(mediaSelectionKey(e.url, i))} label={t("Select {name}", { name: e.title ?? e.url })} onChange={() => undefined} />
            <span className="tnum text-tertiary">{i + 1}</span>
            <span className="thumb" style={e.thumbnail ? { backgroundImage: `url("${e.thumbnail}")` } : undefined} />
            <span className="ellipsis">{e.title ?? e.url}</span>
            <span className="tnum text-tertiary">{formatClock(e.duration)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Streams({ streams, pageUrl, title }: { streams: SniffedStream[]; pageUrl: string; title: string }) {
  return (
    <div className="streams">
      <div className="qsec">{t("Streams detected on the page")}</div>
      {streams.map((s) => (
        <div key={s.url} className="stream">
          <span className="badge">{s.kind.toUpperCase()}</span>
          <span className="ellipsis t-mono" title={s.url}>
            {s.label || s.url}
          </span>
          <span className="tnum text-tertiary">{formatBytes(s.size)}</span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={async () => {
              const item = await attempt(api.addStream(s, pageUrl, title), t("Could not add the stream"));
              if (item) toast(t("Stream added"), { kind: "success", body: item.fileName });
            }}
          >
            {t("Download")}
          </button>
        </div>
      ))}
    </div>
  );
}
