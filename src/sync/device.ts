// A user-editable, friendly name for THIS device, sent with each book registration / cloud sync and
// shown in the account's cloud list so you can tell which device holds each book.
//
// Browsers CANNOT read the real computer name (e.g. "DESKTOP-8OFFRJ5") — there is no such web API
// (privacy). So we default to a platform label (browser / OS) and let the user override it with
// their own name in 情報・ヘルプ. The custom name is stored per-browser in localStorage.
const KEY = "deviceName";

function autoLabel(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Macintosh|Mac OS/.test(ua)
          ? "Mac"
          : /Android/.test(ua)
            ? "Android"
            : /Linux/.test(ua)
              ? "Linux"
              : "不明なOS";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "ブラウザ";
  return `Web · ${browser} / ${os}`;
}

/** The user's custom device name, or the auto platform label when unset. */
export function getDeviceName(): string {
  return localStorage.getItem(KEY)?.trim() || autoLabel();
}

/** Save (or clear, when blank → revert to the auto label) the custom device name. */
export function setDeviceName(name: string): void {
  const v = name.trim();
  if (v) localStorage.setItem(KEY, v);
  else localStorage.removeItem(KEY);
}

/** The label sent to the backend for this device. */
export function deviceLabel(): string {
  return getDeviceName();
}
