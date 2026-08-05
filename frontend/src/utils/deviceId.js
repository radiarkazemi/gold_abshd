import { v4 as uuidv4 } from "uuid";
import { APP_BUILD_V } from "../brandAssets";

const DEVICE_ID_KEY = "goldapp_device_id";

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);

  if (!id) {
    id = uuidv4();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }

  return id;
}

export function getDeviceInfo() {
  return navigator.userAgent || "";
}

/**
 * Rich device fingerprint for digital signature / legal proof on terms acceptance.
 * Collected client-side; server also adds IP and a tamper-evident hash.
 */
export function getDeviceFingerprint(extra = {}) {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const scr = typeof screen !== "undefined" ? screen : {};
  const win = typeof window !== "undefined" ? window : {};
  let connection = null;
  try {
    const c = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (c) {
      connection = {
        effectiveType: c.effectiveType || null,
        downlink: c.downlink ?? null,
        rtt: c.rtt ?? null,
        saveData: c.saveData ?? null,
      };
    }
  } catch {
    /* ignore */
  }

  let timezone = null;
  let timezoneOffset = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    timezoneOffset = new Date().getTimezoneOffset();
  } catch {
    /* ignore */
  }

  return {
    device_id: getDeviceId(),
    user_agent: nav.userAgent || "",
    platform: nav.platform || "",
    vendor: nav.vendor || "",
    language: nav.language || "",
    languages: Array.isArray(nav.languages) ? [...nav.languages] : [],
    cookie_enabled: !!nav.cookieEnabled,
    do_not_track: nav.doNotTrack || null,
    hardware_concurrency: nav.hardwareConcurrency ?? null,
    device_memory: nav.deviceMemory ?? null,
    max_touch_points: nav.maxTouchPoints ?? null,
    screen_width: scr.width ?? null,
    screen_height: scr.height ?? null,
    screen_avail_width: scr.availWidth ?? null,
    screen_avail_height: scr.availHeight ?? null,
    color_depth: scr.colorDepth ?? null,
    pixel_depth: scr.pixelDepth ?? null,
    pixel_ratio: win.devicePixelRatio ?? null,
    inner_width: win.innerWidth ?? null,
    inner_height: win.innerHeight ?? null,
    timezone,
    timezone_offset: timezoneOffset,
    connection,
    app_build: APP_BUILD_V || null,
    accepted_at_client: new Date().toISOString(),
    ...extra,
  };
}
