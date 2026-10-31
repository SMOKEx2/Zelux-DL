/** Messages between content scripts / popup / options and the background (field `kind`). */
import type { ElementSource, MediaItem } from './media';
import type { BatchKind, PostMediaEntry, VideoStream } from './protocol';
import type { StoredState } from './settings';

export type ConnectionState = 'unknown' | 'connected' | 'app_down' | 'host_missing' | 'error';

export interface ConnectionInfo {
  state: ConnectionState;
  appVersion?: string;
  error?: string;
  errorCode?: string;
  checkedAt?: number;
}

export interface VideoOption {
  id: string;
  label: string;
  detail?: string;
  /** `element` = a source of the hovered <video> itself; `stream` = anything else sniffed in the tab. */
  group: 'element' | 'video' | 'audio' | 'stream';
  /** For app-resolved formats. */
  formatId?: string;
  /** For sniffed streams. */
  stream?: VideoStream;
}

export interface VideoOptionsResult {
  source: 'probe' | 'sniffed';
  /** The page the app read the formats from (the hovered post on a feed); downloads use it. */
  pageUrl?: string;
  title?: string;
  options: VideoOption[];
  notice?: string;
}

export type InternalMessage =
  | { kind: 'openUrl'; url: string }
  | { kind: 'bypass'; url?: string; ts: number }
  | { kind: 'videoOptions'; pageUrl: string; title: string; sources?: ElementSource[]; postUrl?: string; tabId?: number }
  | { kind: 'videoDownload'; pageUrl: string; title: string; option: VideoOption; tabId?: number }
  | { kind: 'popupState'; tabId: number }
  | { kind: 'refreshStatus' }
  | { kind: 'retryConnection' }
  | { kind: 'downloadMedia'; tabId: number; key: string }
  | { kind: 'openPostMediaPicker'; tabId: number }
  | { kind: 'probePostMedia'; tabId: number; useSession: boolean }
  | { kind: 'downloadPostMedia'; tabId: number; useSession: boolean; media: { url: string; extension: string; httpHeaders?: Record<string, string>; index: number }[] }
  | { kind: 'collect'; tabId: number; mode: BatchKind; frameId?: number }
  | { kind: 'setPaused'; paused: boolean }
  | { kind: 'openApp'; page?: 'main' | 'browserIntegration' | 'settings' }
  | { kind: 'syncSettings' }
  | { kind: 'saveSettings'; settings: unknown };

export interface PopupState {
  connection: ConnectionInfo;
  media: MediaItem[];
  state: StoredState;
  tabUrl?: string;
  tabTitle?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  count?: number;
}

export interface PostMediaResult extends ActionResult {
  entries?: PostMediaEntry[];
  title?: string;
}
