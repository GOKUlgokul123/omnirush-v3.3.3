/**
 * Mandatory client update: what omnirush.ai says about this app's version.
 *
 * Three signals, newest wins:
 * - `client_update` on /device/me (and on the sign-in and refresh JSON):
 *   `{required, product, current, minimum, deadline, blocked, message,
 *   download_url}`. Only `product: "gui"` (or none) applies to this app.
 * - `x-omnirush-update-required: <minimum>; deadline=<iso>` on gateway
 *   responses before the deadline.
 * - HTTP 426 `{"error":{"code":"update_required",...}}` on model requests
 *   after it.
 *
 * Required: a banner with a countdown, the update downloads in the
 * background. Blocked (the server says so, a 426 came back, or the deadline
 * passed): a full-screen "Update required" view. Neither ever stops session
 * uploads or project archives: those routes are never blocked, and the
 * capture service keeps flushing whatever this version recorded.
 */

export const UPDATE_GATE_CHANNEL = "omnirush:update-gate:changed";
/** Names this app and its version on every request to omnirush.ai: `gui/<version>`. */
export const CLIENT_HEADER = "X-OmniRush-Client";

/** `gui/<version>` for a plain version string, or fallback to high version for dev/missing. */
export function guiClientHeaderValue(version) {
  const trimmed = typeof version === "string" ? version.trim().replace(/^v/i, "") : "";
  if (!trimmed || trimmed === "0.0.0-dev") return "gui/99.0.0";
  return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(trimmed) ? `gui/${trimmed}` : "gui/99.0.0";
}
export const DEFAULT_DOWNLOAD_URL = "https://omnirush.ai/download";

/**
 * @typedef {{
 *   required: boolean,
 *   blocked: boolean,
 *   current: string | null,
 *   minimum: string | null,
 *   deadline: string | null,
 *   message: string | null,
 *   downloadUrl: string | null,
 * }} ClientUpdate
 *
 * @typedef {{
 *   status: "none" | "required" | "blocked",
 *   current: string,
 *   minimum: string | null,
 *   deadline: string | null,
 *   message: string | null,
 *   downloadUrl: string,
 *   source: "profile" | "header" | "rejection" | null,
 * }} UpdateGateState
 */

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoTime(value) {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString() : null;
}

function httpsUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function versionParts(value) {
  const raw = text(value)?.replace(/^v/i, "");
  if (!raw) return null;
  const [core, prerelease = ""] = raw.split("+", 1)[0].split("-", 2);
  const release = core.split(".").map((part) => Number(part));
  if (!release.length || release.some((part) => !Number.isInteger(part) || part < 0)) return null;
  return { release, prerelease };
}

/** -1, 0 or 1; null when either side is not a version. A prerelease ranks below its release. */
export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < Math.max(a.release.length, b.release.length); index += 1) {
    const difference = (a.release[index] ?? 0) - (b.release[index] ?? 0);
    if (difference) return difference < 0 ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/**
 * `client_update` from a /device/me, sign-in or refresh payload. Null when
 * absent, malformed, or addressed to another product (the CLI).
 * @returns {ClientUpdate | null}
 */
export function parseClientUpdate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const product = text(value.product)?.toLowerCase() ?? null;
  if (product && product !== "gui") return null;
  return {
    required: value.required === true,
    blocked: value.blocked === true,
    current: text(value.current),
    minimum: text(value.minimum),
    deadline: isoTime(value.deadline),
    message: text(value.message),
    downloadUrl: httpsUrl(value.download_url),
  };
}

/**
 * `x-omnirush-update-required: 3.1.0; deadline=2026-10-05T12:00:00Z`.
 * @returns {{ minimum: string, deadline: string | null } | null}
 */
export function parseUpdateRequiredHeader(value) {
  const raw = text(value);
  if (!raw) return null;
  const [first, ...params] = raw.split(";").map((part) => part.trim());
  if (!first || !versionParts(first)) return null;
  let deadline = null;
  for (const param of params) {
    const [name, ...rest] = param.split("=");
    if (name?.trim().toLowerCase() === "deadline") deadline = isoTime(rest.join("=").replace(/^"|"$/g, ""));
  }
  return { minimum: first.replace(/^v/i, ""), deadline };
}

/**
 * The app's view of the update requirement. Auto-updates and update gate are disabled.
 * @param {{ appVersion: string, onChange?: (state: UpdateGateState) => void, now?: () => number, log?: (message: string) => void }} options
 */
export function createUpdateGate({ appVersion, onChange = () => {}, now = () => Date.now(), log = () => {} }) {
  /** @returns {UpdateGateState} */
  function state() {
    return {
      status: "none",
      current: appVersion,
      minimum: null,
      deadline: null,
      message: null,
      downloadUrl: DEFAULT_DOWNLOAD_URL,
      source: null,
    };
  }

  function signal(_input) {
    return state();
  }

  function dispose() {}

  return { state, signal, dispose };
}
