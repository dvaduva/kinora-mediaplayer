/** What a remote, keyboard or media key means to the UI. Arrows and Enter stay with spatial navigation. */
export type RemoteAction =
  | "back"
  | "play"
  | "pause"
  | "playPause"
  | "stop"
  | "fastForward"
  | "rewind"
  | "next"
  | "previous"
  | "channelUp"
  | "channelDown";

/** Key codes the TVs send: Tizen (10009, 10252, 10232/10233, 427/428) and webOS (461); the rest are shared. */
const CODES: Record<number, RemoteAction> = {
  10009: "back",
  461: "back",
  415: "play",
  19: "pause",
  10252: "playPause",
  413: "stop",
  417: "fastForward",
  412: "rewind",
  10233: "next",
  10232: "previous",
  427: "channelUp",
  428: "channelDown",
};

/** `KeyboardEvent.key` names from desktop browsers, Android WebView and media keyboards. */
const KEYS: Record<string, RemoteAction> = {
  Escape: "back",
  GoBack: "back",
  BrowserBack: "back",
  XF86Back: "back",
  MediaPlay: "play",
  MediaPause: "pause",
  MediaPlayPause: "playPause",
  MediaStop: "stop",
  MediaFastForward: "fastForward",
  MediaRewind: "rewind",
  MediaTrackNext: "next",
  MediaTrackPrevious: "previous",
  ChannelUp: "channelUp",
  ChannelDown: "channelDown",
};

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable));
}

export function remoteAction(event: KeyboardEvent): RemoteAction | null {
  const byCode = CODES[event.keyCode];
  if (byCode) return byCode;
  // Backspace edits text in a field; elsewhere it is the browser's Back.
  if (event.key === "Backspace") return isTyping(event.target) ? null : "back";
  return KEYS[event.key] ?? null;
}

type TizenInput = { registerKeyBatch?: (keys: string[]) => void; registerKey?: (key: string) => void };

/** Tizen delivers media and channel keys only after registering them; webOS and browsers send them anyway. */
export const TIZEN_KEYS = [
  "MediaPlay",
  "MediaPause",
  "MediaPlayPause",
  "MediaStop",
  "MediaFastForward",
  "MediaRewind",
  "MediaTrackNext",
  "MediaTrackPrevious",
  "ChannelUp",
  "ChannelDown",
];

export function registerRemoteKeys() {
  const input = (window as unknown as { tizen?: { tvinputdevice?: TizenInput } }).tizen?.tvinputdevice;
  if (!input) return;
  try {
    if (input.registerKeyBatch) input.registerKeyBatch(TIZEN_KEYS);
    else for (const key of TIZEN_KEYS) input.registerKey?.(key);
  } catch {
    // An older firmware without one of the keys: the rest still work through the shell's registration.
  }
}
