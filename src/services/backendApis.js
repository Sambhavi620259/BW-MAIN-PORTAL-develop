import {
  backendBlob,
  backendJson,
  backendMultipart,
  backendPost,
} from "./backendClient";
import {
  assertKycMultipartFormData,
  logKycMultipartDev,
} from "../utils/kycUpload";

/**
 * Spring often returns 500 "No static resource …" when a route is not mapped (not 404).
 * Treat like missing route so ticket APIs can fall back to legacy paths.
 */
function isMissingBackendRouteError(err) {
  const st = err?.status;
  if (st === 404 || st === 405) return true;
  if (st === 500 || st === 501) {
    const msg = String(
      err?.message ??
        err?.payload?.message ??
        err?.data?.message ??
        err?.response?.data?.message ??
        "",
    ).toLowerCase();
    if (
      msg.includes("no static resource") ||
      msg.includes("static resource") ||
      msg.includes("nohandlerfound") ||
      msg.includes("no handler found") ||
      msg.includes("no endpoint") ||
      msg.includes("not found") && msg.includes("kyc")
    ) {
      return true;
    }
  }
  return false;
}

async function withAdminKycRouteFallback(primaryCall, fallbackCall) {
  try {
    return await primaryCall();
  } catch (err) {
    if (isMissingBackendRouteError(err)) {
      return fallbackCall();
    }
    throw err;
  }
}

/**
 * User auth (`/login`, `/verify-otp`, email verification).
 */
export const authBackend = {
  login({ email, password }) {
    return backendPost("/login", { email, password });
  },
  verifyOtp({ email, otp }) {
    const body = { email, otp };
    return backendPost("/verify-otp", body).catch((err) => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[authBackend.verifyOtp] error response:", err?.status);
      }
      throw err;
    });
  },
  /**
   * GET `/verify-email?token=…` — completes email verification from registration link.
   */
  verifyEmailByToken(token, opts = {}) {
    const t = String(token ?? "").trim();
    return backendJson("/verify-email", {
      method: "GET",
      query: { token: t },
      suppressGlobalServerErrorToast: true,
      ...opts,
    });
  },
};

export const adminAuthBackend = {
  login({ email, password, secret }) {
    /**
     * Backend property is `admin.secret = SUPER_ADMIN_SECRET_Sandeep_2026`. The DTO
     * field name in the controller has not been confirmed, and the previous shape
     * `{ email, password, secret }` started returning 401 from
     * `POST /api/v1.0/admin/auth/login`.
     *
     * Send every plausible field-name variant in one body — Spring Boot's default
     * Jackson config (`failOnUnknownProperties: false`) ignores any keys the DTO
     * doesn't declare, so whichever name the backend binds to (`secret`,
     * `adminSecret`, `secretKey`, `adminCode`) will match. Also mirror the value
     * into an `X-Admin-Secret` header for controllers that read it via
     * `@RequestHeader`.
     *
     * `username` duplicates `email` for DTOs that use `username` as the login id
     * (still an email address).
     */
    const trimmedEmail = typeof email === "string" ? email.trim() : email;
    const trimmedSecret = typeof secret === "string" ? secret.trim() : secret;

    const json = {
      email: trimmedEmail,
      username: trimmedEmail,
      /** Never trim password — spaces may be intentional. */
      password,
      secret: trimmedSecret,
      adminSecret: trimmedSecret,
      secretKey: trimmedSecret,
      adminCode: trimmedSecret,
    };

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.group("[adminAuth.login] → POST /api/v1.0/admin/auth/login");
      // eslint-disable-next-line no-console
      console.log("body keys:", Object.keys(json));
      // eslint-disable-next-line no-console
      console.log(
        "email: length only =",
        typeof trimmedEmail === "string" ? trimmedEmail.length : 0,
      );
      // eslint-disable-next-line no-console
      console.log(
        "password: length only =",
        typeof password === "string" ? password.length : "(none)",
      );
      // eslint-disable-next-line no-console
      console.log(
        "secret: length only =",
        trimmedSecret ? String(trimmedSecret).length : 0,
      );
      // eslint-disable-next-line no-console
      console.log(
        "note: Bearer not attached; credentials mode include (see [API:apiFetch] line)",
      );
      // eslint-disable-next-line no-console
      console.groupEnd();
    }

    return backendJson("/admin/auth/login", {
      method: "POST",
      json,
      headers: trimmedSecret
        ? { "X-Admin-Secret": String(trimmedSecret) }
        : undefined,
      suppressGlobalServerErrorToast: true,
    })
      .then((data) => {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log(
            "[adminAuth.login] response OK; data keys:",
            data && typeof data === "object" ? Object.keys(data) : typeof data,
          );
        }
        return data;
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[adminAuth.login] error:", {
            status: err?.status,
            message: err?.message,
            payloadKeys:
              err?.payload && typeof err.payload === "object"
                ? Object.keys(err.payload)
                : null,
          });
        }
        throw err;
      });
  },
  verifyOtp({ email, otp }) {
    const body = { email, otp };
    return backendJson("/admin/auth/verify-otp", {
      method: "POST",
      json: body,
      suppressGlobalServerErrorToast: true,
    }).catch((err) => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          "[adminAuthBackend.verifyOtp] error response:",
          err?.status,
          err?.message,
        );
      }
      throw err;
    });
  },
};

export const profileBackend = {
  getProfile() {
    return backendJson("/profile", { method: "GET" });
  },
  updateProfile({ name, phoneNumber }) {
    return backendJson("/profile", {
      method: "PUT",
      json: { name, phoneNumber },
    });
  },
  uploadPhoto(file) {
    const fd = new FormData();
    fd.append("file", file);
    return backendMultipart("/profile/upload-photo", fd);
  },
  /** @deprecated Not deployed — use PUT /profile for phone; email via admin/support. */
  updateContactInit(payload) {
    return backendJson("/profile/update-contact/init", {
      method: "POST",
      json: payload ?? {},
    });
  },
  /** @deprecated Not deployed — use PUT /profile for phone; email via admin/support. */
  updateContactVerify(payload) {
    return backendJson("/profile/update-contact/verify", {
      method: "POST",
      json: payload ?? {},
    });
  },
};

export const dashboardBackend = {
  /** @param {object} [opts] — optional `suppressGlobalServerErrorToast` for resilient dashboards */
  getSummary(opts = {}) {
    return backendJson("/dashboard/summary", { method: "GET", ...opts });
  },
  getTransactions({ page = 0, size = 80, ...opts } = {}) {
    const qs = new URLSearchParams({
      page: String(page),
      size: String(size),
    });
    return backendJson(`/dashboard/transactions?${qs.toString()}`, {
      method: "GET",
      ...opts,
    });
  },
  /** GET /dashboard/recent-apps */
  getRecentApps(opts = {}) {
    return backendJson("/dashboard/recent-apps", { method: "GET", ...opts });
  },
  /**
   * GET /dashboard/app-usage-timeseries
   * @param {string|number} appId
   * @param {string} range e.g. 24h, 7d, 30d
   * @param {string} interval e.g. hour, day
   */
  async getAppUsageTimeseries(appId, range, interval, opts = {}) {
    const qs = new URLSearchParams({
      appId: String(appId),
      range: String(range ?? ""),
      interval: String(interval ?? ""),
    });
    const suffix = qs.toString();
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    try {
      return await backendJson(`/dashboard/app-usage-timeseries?${suffix}`, {
        method: "GET",
        ...opts,
      });
    } catch (err) {
      if (err?.status === 404 || err?.status === 405) {
        return backendJson(`/dashboard/app-usage?${suffix}`, {
          method: "GET",
          ...quiet,
        });
      }
      throw err;
    }
  },
};

function unwrapMyApplicationsList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.content)) return res.content;
  if (Array.isArray(res?.applications)) return res.applications;
  if (Array.isArray(res?.items)) return res.items;
  if (res?.data && Array.isArray(res.data?.content)) return res.data.content;
  return [];
}

export const applicationBackend = {
  list(opts = {}) {
    const qs = new URLSearchParams();
    if (opts.size != null) qs.set("size", String(opts.size));
    if (opts.page != null) qs.set("page", String(opts.page));
    const query = qs.toString();
    const path = query ? `/application/list?${query}` : "/application/list";
    const { size: _s, page: _p, ...rest } = opts;
    return backendJson(path, { method: "GET", ...rest });
  },
  async my(opts = {}) {
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    const paths = ["/application/my", "/app/my"];
    let lastErr = null;
    for (const path of paths) {
      try {
        const res = await backendJson(path, { method: "GET", ...quiet });
        return unwrapMyApplicationsList(res);
      } catch (err) {
        lastErr = err;
        if (err?.status === 401 || err?.status === 403) throw err;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  },
  open(appId) {
    return backendPost("/application/open", { appId });
  },
  unsubscribe(appId, opts = {}) {
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    return backendJson(
      `/application/my/${encodeURIComponent(String(appId))}`,
      { method: "DELETE", ...quiet },
    );
  },
};

function unwrapFavoritesList(res) {
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object") {
    const data = res.data;
    if (Array.isArray(data)) return data;
    for (const k of ["items", "content", "favorites", "results", "records"]) {
      if (Array.isArray(res[k])) return res[k];
      if (data && typeof data === "object" && Array.isArray(data[k]))
        return data[k];
    }
  }
  return [];
}


  /**
   * GET /favorites/my (Authify). Falls back to GET /favorites/list for older deployments.
   */
  export const favoritesBackend = {

    /**
     * GET FAVORITES
     */
    async list(opts = {}) {
  
      const quiet = {
        suppressGlobalServerErrorToast: true,
        ...opts,
      };
  
      try {
  
        let res;
  
        try {
  
          res = await backendJson(
            "/favorites/my",
            {
              method: "GET",
              ...quiet,
            }
          );
  
        } catch (e) {
  
          const errMsg =
            e && typeof e === "object"
              ? String(
                  (
                    e.payload &&
                    (
                      e.payload.error ||
                      e.payload.message
                    )
                  ) ||
                  e.message ||
                  ""
                )
              : String(e || "");
  
          // fallback endpoint support
          if (
            e?.status === 404 ||
            e?.status === 405 ||
            (
              e?.status === 500 &&
              /request method.*GET/i.test(errMsg)
            )
          ) {
  
            res = await backendJson(
              "/favorites/list",
              {
                method: "GET",
                ...quiet,
              }
            );
  
          } else {
  
            throw e;
          }
        }
  
        if (import.meta.env.DEV) {
          const count = Array.isArray(res)
            ? res.length
            : Array.isArray(res?.data)
              ? res.data.length
              : Array.isArray(res?.content)
                ? res.content.length
                : 0;
          // eslint-disable-next-line no-console
          console.log("[favoritesBackend.list] loaded", { count });
        }
  
        // DIRECT ARRAY
        if (Array.isArray(res)) {
          return res;
        }
  
        // SPRING BOOT RESPONSE
        if (Array.isArray(res?.data)) {
          return res.data;
        }
  
        // PAGE CONTENT
        if (Array.isArray(res?.content)) {
          return res.content;
        }
  
        // NESTED PAGE CONTENT
        if (
          res?.data &&
          Array.isArray(res.data?.content)
        ) {
          return res.data.content;
        }
  
        // FALLBACK NORMALIZER
        return unwrapFavoritesList(res);
  
      } catch (err) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            "[favoritesBackend.list] fetch failed",
            err?.status,
            err?.message,
          );
        }

        return [];
      }
    },
  
    /**
     * ADD FAVORITE
     */
    add(appId) {
  
      return backendJson(
        `/favorites/${encodeURIComponent(String(appId))}`,
        {
          method: "POST",
        }
      );
    },
  
    /**
     * TOGGLE FAVORITE
     */
    toggle(appId) {
  
      return backendJson(
        `/favorites/toggle/${encodeURIComponent(String(appId))}`,
        {
          method: "PUT",
          json: {},
        }
      );
    },
  
    /**
     * REMOVE FAVORITE
     */
    remove(appId) {
  
      return backendJson(
        `/favorites/${encodeURIComponent(String(appId))}`,
        {
          method: "DELETE",
        }
      );
    },
  };

function submitKycMultipart(path, formData) {
  assertKycMultipartFormData(formData);
  logKycMultipartDev(path, formData);
  return backendMultipart(path, formData);
}

function kycPresignStoredUrlQuery(storedUrl) {
  return new URLSearchParams({
    storedUrl: String(storedUrl ?? "").trim(),
  });
}

/** Legacy servers map GET /admin/kyc/document-access → /{kycId} (Long parse error). */
export function isKycPresignRouteCollisionError(err) {
  if (err?.status !== 500) return false;
  const msg = String(
    err?.message ??
      err?.payload?.message ??
      err?.data?.message ??
      "",
  ).toLowerCase();
  return (
    msg.includes("methodargumenttypemismatch") ||
    (msg.includes("failed to convert") && msg.includes("long")) ||
    (msg.includes("document-access") && msg.includes("long"))
  );
}

/** Try next presign route when endpoint is missing or collides with /{kycId}. */
export function isRetriableKycPresignError(err) {
  const st = err?.status;
  if (st === 404 || st === 405) return true;
  return isKycPresignRouteCollisionError(err);
}

async function fetchKycPresignUrl(pathAttempts, storedUrl, opts = {}) {
  const canonical = String(storedUrl ?? "").trim();
  const quiet = { suppressGlobalServerErrorToast: true, ...opts };
  let lastErr;

  for (const attempt of pathAttempts) {
    try {
      if (attempt.method === "POST") {
        return await backendJson(attempt.path, {
          method: "POST",
          json: { storedUrl: canonical },
          ...quiet,
          ...attempt.opts,
        });
      }
      const qs = kycPresignStoredUrlQuery(canonical);
      return await backendJson(`${attempt.path}?${qs.toString()}`, {
        method: "GET",
        ...quiet,
        ...attempt.opts,
      });
    } catch (err) {
      lastErr = err;
      if (!isRetriableKycPresignError(err)) throw err;
    }
  }

  throw lastErr ?? new Error("KYC document presign unavailable");
}

export const kycBackend = {
  me() {
    return backendJson("/kyc/me", { method: "GET" });
  },
  /** Presigned URL for user's own KYC file (collision-safe path order). */
  documentAccess(storedUrl, opts = {}) {
    return fetchKycPresignUrl(
      [
        { method: "GET", path: "/kyc-documents/presign-url" },
        { method: "POST", path: "/kyc/presign" },
        { method: "GET", path: "/kyc/presign-url" },
        { method: "GET", path: "/kyc/document-access" },
      ],
      storedUrl,
      opts,
    );
  },
  /** Multipart KYC document upload — POST /kyc/upload */
  upload(formData) {
    return submitKycMultipart("/kyc/upload", formData);
  },
  /** Multipart re-upload after REJECTED / REUPLOAD_REQUIRED — POST /profile/kyc/reupload */
  reupload(formData) {
    return submitKycMultipart("/profile/kyc/reupload", formData);
  },
  resubmit(payload) {
    return backendPost("/kyc/resubmit", payload ?? {});
  },
};

/** Admin KYC moderation — canonical `/admin/kyc/*` (Spring Authify backend). */
export const kycAdminBackend = {
  listAll(opts = {}) {
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    return withAdminKycRouteFallback(
      () => backendJson("/admin/kyc/all", { method: "GET", ...opts }),
      () => backendJson("/kyc/all", { method: "GET", ...quiet }),
    );
  },
  listPending(opts = {}) {
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    return withAdminKycRouteFallback(
      () => backendJson("/admin/kyc/pending", { method: "GET", ...opts }),
      () => backendJson("/kyc/pending", { method: "GET", ...quiet }),
    );
  },
  getByKycId(kycId, opts = {}) {
    const id = encodeURIComponent(String(kycId));
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    return withAdminKycRouteFallback(
      () => backendJson(`/admin/kyc/${id}`, { method: "GET", ...opts }),
      () => backendJson(`/kyc/${id}`, { method: "GET", ...quiet }),
    );
  },
  /** @deprecated use getByKycId — numeric KYC record id, not USR-* userId */
  getByUserId(kycId, opts = {}) {
    return kycAdminBackend.getByKycId(kycId, opts);
  },
  /** Presigned URL for admin review (collision-safe path order). */
  documentAccess(storedUrl, opts = {}) {
    return fetchKycPresignUrl(
      [
        { method: "GET", path: "/admin/kyc-documents/presign-url" },
        { method: "POST", path: "/admin/kyc/presign" },
        { method: "GET", path: "/admin/kyc/presign-url" },
        { method: "GET", path: "/admin/kyc/document-access" },
      ],
      storedUrl,
      opts,
    );
  },
  verify(kycId, body = {}, opts = {}) {
    const id = encodeURIComponent(String(kycId));
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    return withAdminKycRouteFallback(
      () =>
        backendJson(`/admin/kyc/verify/${id}`, {
          method: "PUT",
          json: body,
          ...opts,
        }),
      () =>
        backendJson(`/kyc/verify/${id}`, {
          method: "PUT",
          json: body,
          ...quiet,
        }),
    );
  },
  reject(kycId, body = {}, opts = {}) {
    const id = encodeURIComponent(String(kycId));
    const reasonRaw =
      (typeof body?.reason === "string" && body.reason.trim()) ||
      (typeof body?.rejectionReason === "string" && body.rejectionReason.trim()) ||
      (typeof body?.rejectReason === "string" && body.rejectReason.trim()) ||
      "";
    const qs = reasonRaw ? `?${new URLSearchParams({ reason: reasonRaw }).toString()}` : "";
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    const rejectBody =
      reasonRaw && body && typeof body === "object"
        ? {
            ...body,
            reason: reasonRaw,
            rejectionReason: reasonRaw,
            rejectReason: reasonRaw,
            kycRejectionReason: reasonRaw,
            comment: reasonRaw,
            notes: reasonRaw,
          }
        : body && typeof body === "object"
          ? body
          : {};
    return withAdminKycRouteFallback(
      () =>
        backendJson(`/admin/kyc/reject/${id}${qs}`, {
          method: "PUT",
          json: rejectBody,
          ...opts,
        }),
      () =>
        backendJson(`/kyc/reject/${id}${qs}`, {
          method: "PUT",
          json: rejectBody,
          ...quiet,
        }),
    );
  },
};

export const notificationsBackend = {
  /** GET /notifications/my — paginated inbox (user-scoped). */
  list({ page = 0, size = 10, ...opts } = {}) {
    const qs = new URLSearchParams({ page: String(page), size: String(size) });
    return backendJson(`/notifications/my?${qs.toString()}`, {
      method: "GET",
      ...opts,
    });
  },
  /** GET /notifications/admin — admin-global inbox (Authify contract). */
  adminList({ page = 0, size = 10, ...opts } = {}) {
    const qs = new URLSearchParams({ page: String(page), size: String(size) });
    return backendJson(`/notifications/admin?${qs.toString()}`, {
      method: "GET",
      ...opts,
    });
  },
  /** GET /notifications/unread-count */
  unreadCount(opts = {}) {
    return backendJson("/notifications/unread-count", {
      method: "GET",
      ...opts,
    });
  },
  /** Admin uses the same unread-count route as users (Authify contract). */
  adminUnreadCount(opts = {}) {
    return this.unreadCount(opts);
  },
  markRead(id) {
    return backendJson(
      `/notifications/${encodeURIComponent(String(id))}/read`,
      {
        method: "PUT",
        json: {},
      },
    );
  },
  readAll() {
    return backendJson("/notifications/read-all", { method: "PUT", json: {} });
  },
  deleteById(id) {
    return backendJson(`/notifications/${encodeURIComponent(String(id))}`, {
      method: "DELETE",
    });
  },
};

export const activityBackend = {
  /** GET /activity/my — paginated activity feed (Spring-style page or raw array). */
  list({ page = 0, size = 10, ...opts } = {}) {
    const qs = new URLSearchParams({ page: String(page), size: String(size) });
    return backendJson(`/activity/my?${qs.toString()}`, {
      method: "GET",
      ...opts,
    });
  },
  /** GET /activity/admin — admin activity feed. */
  async adminList({ page = 0, size = 10, ...opts } = {}) {
    const qs = new URLSearchParams({ page: String(page), size: String(size) });
    const suffix = qs.toString();
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    try {
      return await backendJson(`/activity/admin?${suffix}`, {
        method: "GET",
        ...opts,
      });
    } catch (err) {
      if (err?.status === 404 || err?.status === 405) {
        return backendJson(`/admin/activity?${suffix}`, {
          method: "GET",
          ...quiet,
        });
      }
      throw err;
    }
  },
  /** @deprecated use list() — alias for backward compatibility */
  my(opts) {
    return this.list(opts);
  },
};

export const ticketsBackend = {
  async create(payload) {
    const res = await backendPost("/tickets/create", payload ?? {});
    // Support `{ success: true, data: {...} }` without breaking existing callers.
    const normalized = res?.data ?? res;
    return normalized;
  },
  my(opts = {}) {
    const qs = new URLSearchParams();
    const status = String(opts.status ?? "").trim().toUpperCase();
    if (status) qs.set("status", status);
    const query = qs.toString();
    const path = query ? `/tickets/my?${query}` : "/tickets/my";
    const { status: _st, ...rest } = opts;
    return backendJson(path, { method: "GET", ...rest });
  },
  async getById(id, opts = {}) {
    const res = await backendJson(
      `/tickets/${encodeURIComponent(String(id))}`,
      { method: "GET", ...opts },
    );
    return res;
  },
  /** POST /tickets/{ticketId}/reply — deployed canonical route (no legacy /tickets/reply/{id} probe). */
  async reply(payload, opts = {}) {
    const p = payload && typeof payload === "object" ? payload : {};
    const tid = p.ticketId ?? p.id;
    if (tid == null || String(tid).trim() === "") {
      throw new Error("Reply requires ticketId or id in the payload");
    }
    const idEnc = encodeURIComponent(String(tid));
    const body = {
      ...p,
      message: p.message ?? p.body,
      body: p.body ?? p.message,
    };
    return backendJson(`/tickets/${idEnc}/reply`, {
      ...opts,
      method: "POST",
      json: body,
    });
  },
  /** PUT /tickets/status/{ticketId} — legacy PATCH fallback. */
  async resolve(id, status = "RESOLVED", opts = {}) {
    const idEnc = encodeURIComponent(String(id));
    const json = { status: String(status || "").toUpperCase() };
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    try {
      return await backendJson(`/tickets/status/${idEnc}`, {
        method: "PUT",
        json,
        ...opts,
      });
    } catch (err) {
      if (isMissingBackendRouteError(err)) {
        return backendJson(`/admin/tickets/${idEnc}/status`, {
          method: "PATCH",
          json,
          ...quiet,
        });
      }
      throw err;
    }
  },
  /** GET /tickets/admin — admin ticket list (legacy /admin/tickets fallback). */
  async adminList(opts = {}) {
    const qs = new URLSearchParams();
    const status = String(opts.status ?? "").trim().toUpperCase();
    if (status) qs.set("status", status);
    const suffix = qs.toString();
    const path = suffix ? `/tickets/admin?${suffix}` : "/tickets/admin";
    const quiet = { suppressGlobalServerErrorToast: true, ...opts };
    const { status: _st, ...rest } = opts;
    try {
      return await backendJson(path, { method: "GET", ...rest });
    } catch (err) {
      if (err?.status === 404 || err?.status === 405) {
        const legacy = suffix ? `/admin/tickets?${suffix}` : "/admin/tickets";
        return backendJson(legacy, { method: "GET", ...quiet });
      }
      throw err;
    }
  },
  /** Admin detail — same route as user (`GET /tickets/{id}`); no `/tickets/admin/{id}` probe. */
  getAdminById(id, opts = {}) {
    return this.getById(id, opts);
  },
};

export const sessionsBackend = {
  list() {
    return backendJson("/settings/sessions", { method: "GET" });
  },
  revoke(sessionId) {
    return backendJson(`/sessions/${encodeURIComponent(String(sessionId))}`, {
      method: "DELETE",
    });
  },
};

export const settingsBackend = {
  me() {
    return backendJson("/settings/me", { method: "GET" });
  },
  update(payload) {
    return backendJson("/settings/me", { method: "PUT", json: payload ?? {} });
  },
  changePassword(payload) {
    return backendPost("/settings/change-password", payload ?? {});
  },
  logoutAll() {
    return backendPost("/settings/logout-all", {});
  },
  deactivate(payload) {
    return backendJson("/settings/deactivate", {
      method: "PUT",
      json: payload ?? {},
    });
  },
  exportBlob() {
    return backendBlob("/settings/export", { method: "GET" });
  },
};

export const passwordBackend = {
  forgotPassword(email) {
    return backendPost("/forgot-password", { email });
  },
  resetPassword(payload) {
    return backendPost("/reset-password", payload ?? {});
  },
};

export const appBackend = {

  apply(appId) {
    return backendPost("/application/open", { appId });
  },

  get(appId) {

    return backendJson(

      `/application/${appId}`,

      {
        method: "GET",
      }
    );
  },
};