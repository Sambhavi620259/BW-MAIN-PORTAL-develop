import { apiFetch } from "./apiFetch";
import { showError } from "./toast";

const DEFAULT_TIMEOUT_MS = 15_000;

function toError(message, extras = {}) {
  const err = new Error(message || "Something went wrong");
  Object.assign(err, extras);
  return err;
}

/**
 * Rewrite mistaken GET detail refreshes that target legacy `/tickets/reply/{id}`.
 */
function normalizeTicketApiPath(path, requestOptions = {}) {
  const p = String(path || "");
  const rawMethod = requestOptions?.method;
  const method = String(
    rawMethod || (requestOptions?.body != null ? "POST" : "GET"),
  ).toUpperCase();
  const match = p.match(/^\/tickets\/reply\/([^/]+)\/?$/);
  if (match && method === "GET") {
    return `/tickets/${match[1]}`;
  }
  return p;
}

function buildQueryString(path, query) {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "")}`;
  if (!query || typeof query !== "object") return normalizedPath;

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });

  const qs = params.toString();
  if (!qs) return normalizedPath;
  return normalizedPath.includes("?")
    ? `${normalizedPath}&${qs}`
    : `${normalizedPath}?${qs}`;
}

function mergeAbortSignals(primary, secondary) {
  if (
    primary &&
    secondary &&
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.any === "function"
  ) {
    return AbortSignal.any([primary, secondary]);
  }
  return primary || secondary || undefined;
}

function withTimeout(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return { signal, cleanup: () => {} };
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return {
    signal: mergeAbortSignals(signal, controller.signal),
    cleanup: () => clearTimeout(id),
  };
}

/** Spring-style validation and generic API error text */
export function buildApiErrorMessage(payload, fallback) {
  if (payload == null) return fallback;
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (typeof payload !== "object") return fallback;
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  const nested =
    payload.data && typeof payload.data === "object" ? payload.data : null;
  if (nested) {
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
    if (typeof nested.error === "string" && nested.error.trim()) {
      return nested.error.trim();
    }
  }
  if (Array.isArray(payload.errors)) {
    const parts = payload.errors
      .map((e) =>
        e && typeof e === "object"
          ? e.defaultMessage || e.message || ""
          : String(e || ""),
      )
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  if (payload.errors && typeof payload.errors === "object" && !Array.isArray(payload.errors)) {
    const parts = Object.entries(payload.errors).map(([k, v]) => {
      const val = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      return `${k}: ${val}`;
    });
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

/** Prefer structured `payload` from `backendJson` errors, then `Error.message`. */
export function getApiErrorMessage(err, fallback = "Request failed") {
  const fromPayload = buildApiErrorMessage(err?.payload, "");
  if (fromPayload) return fromPayload;
  if (typeof err?.message === "string" && err.message.trim()) return err.message.trim();
  return fallback;
}

async function readJsonSafe(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function unwrapBackendEnvelope(res, unwrapOptions = {}) {
  const { suppressGlobalServerErrorToast } = unwrapOptions || {};
  // apiFetch returns null on most 401s (global logout); optional paths return the Response instead.
  if (!res) throw toError("Session expired. Please login again.", { status: 401 });

  const payload = await readJsonSafe(res);
  if (!res.ok) {
    const fallback = `HTTP ${res.status}`;
    const message = buildApiErrorMessage(payload, fallback);
    if (res.status >= 500 && !suppressGlobalServerErrorToast) {
      showError(message !== fallback ? message : "Server error. Please try again shortly.");
    }
    throw toError(message, { status: res.status, payload });
  }

  if (!payload || typeof payload !== "object") return payload;

  // Standard backend envelopes:
  // - `{ status: number, data: ... }`
  // - `{ success: boolean, data: ... }`
  // Avoid treating unrelated body shapes (e.g. `{ token, message }`) as envelopes unless `data` is explicit.
  const hasData = Object.prototype.hasOwnProperty.call(payload, "data");
  const looksLikeStatusEnvelope = typeof payload.status === "number" && hasData;
  const looksLikeSuccessEnvelope = typeof payload.success === "boolean" && hasData;
  if (looksLikeStatusEnvelope || looksLikeSuccessEnvelope) {
    return payload.data;
  }

  return payload;
}

/**
 * Calls backend using centralized `apiFetch()` and unwraps the standard envelope:
 *   { status: number, message?: string, data: any }
 *
 * Returns `data` directly.
 */
export async function backendJson(path, options = {}) {
  const {
    json,
    suppressGlobalServerErrorToast,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    query,
    ...fetchOptions
  } = options || {};
  const requestOptions = json
    ? {
        ...fetchOptions,
        method: fetchOptions.method || "POST",
        body: JSON.stringify(json),
      }
    : fetchOptions;

  const t = withTimeout(signal, timeoutMs);
  try {
    const finalPath = buildQueryString(
      normalizeTicketApiPath(path, requestOptions),
      query,
    );
    const res = await apiFetch(finalPath, { ...requestOptions, signal: t.signal });
    return unwrapBackendEnvelope(res, { suppressGlobalServerErrorToast });
  } catch (e) {
    if (e instanceof Error) throw e;
    throw toError(typeof e === "string" ? e : "Request failed");
  } finally {
    t.cleanup();
  }
}

export async function backendPost(path, body) {
  return backendJson(path, { method: "POST", json: body ?? {} });
}

export async function backendBlob(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, query, ...rest } = options || {};
  const t = withTimeout(signal, timeoutMs);
  const finalPath = buildQueryString(path, query);
  const res = await apiFetch(finalPath, {
    ...(rest || {}),
    method: options?.method || "GET",
    signal: t.signal,
  });
  if (!res) throw toError("Session expired. Please login again.", { status: 401 });
  if (!res.ok) {
    const payload = await readJsonSafe(res);
    const fallback = `HTTP ${res.status}`;
    const message = buildApiErrorMessage(payload, fallback);
    if (res.status >= 500) {
      showError(message !== fallback ? message : "Server error. Please try again shortly.");
    }
    throw toError(message, { status: res.status, payload });
  }
  try {
    return await res.blob();
  } finally {
    t.cleanup();
  }
}

export async function backendMultipart(path, formData, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    query,
    suppressGlobalServerErrorToast,
    ...rest
  } = options || {};
  const t = withTimeout(signal, timeoutMs);
  try {
    const finalPath = buildQueryString(path, query);
    const res = await apiFetch(finalPath, {
      ...(rest || {}),
      method: options?.method || "POST",
      body: formData,
      signal: t.signal,
    });
    return unwrapBackendEnvelope(res, { suppressGlobalServerErrorToast });
  } catch (e) {
    if (e instanceof Error) throw e;
    throw toError(typeof e === "string" ? e : "Request failed");
  } finally {
    t.cleanup();
  }
}

