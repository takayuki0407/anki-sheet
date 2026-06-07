// A friendly label for the current device, sent with each book registration and shown in the
// account's over-limit chooser so the user can tell which device imported each book. (The native
// iOS app will send "iPhone" / "iPad" instead.)
export function deviceLabel(): string {
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
