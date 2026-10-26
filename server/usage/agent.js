/**
 * Device, browser and OS from a User-Agent string — for the "How they
 * connect" panel only, so a coarse, dependency-free reading is enough.
 * Order matters: Edge and Opera identify as Chrome too, and every iPhone
 * browser says Safari.
 */
export function parseUserAgent(ua = '') {
  const s = String(ua)

  const device = /iPad|Tablet/i.test(s) ? 'Tablet' : /Mobi|iPhone|Android/i.test(s) ? 'Mobile' : 'Desktop'

  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(s)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : 'Other'

  const os = /Windows/.test(s)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(s)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(s)
        ? 'macOS'
        : /Android/.test(s)
          ? 'Android'
          : /Linux|X11/.test(s)
            ? 'Linux'
            : 'Other'

  return { device, browser, os }
}
