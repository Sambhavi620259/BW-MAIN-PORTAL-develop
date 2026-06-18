import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setLogoutHandler } from "../services/logoutBridge";
import { profileBackend } from "../services/backendApis";
import { invalidateDashboardBundleCache } from "../services/dashboardBundleCache";
import { cancelDebouncedDashboardInvalidate } from "../services/dashboardInvalidate";
import { invalidateRecentAppsCache } from "../services/recentAppsCache";
import { invalidateUsageTimeseriesCache } from "../services/usageTimeseriesCache";

const TOKEN_KEY = "ui-access-token";
const USER_ID_KEY = "userId";
const PROFILE_KEY = "ui-profile";
const ROLE_KEY = "ui-role";

const AuthContext = createContext(null);

/** Decode JWT payload (no signature verification — UI role hint only). */
function parseJwtPayload(accessToken) {
  try {
    const parts = String(accessToken || "").split(".");
    if (parts.length < 2) return null;
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeRoleClaim(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = normalizeRoleClaim(v);
      if (r) return r;
    }
    return "";
  }
  if (typeof value === "object") {
    if (typeof value.authority === "string") return value.authority.trim();
    if (typeof value.role === "string") return value.role.trim();
    if (typeof value.name === "string") return value.name.trim();
  }
  return "";
}

/** Map API/JWT hints to `ROLE_USER` | `ROLE_ADMIN` | `ROLE_OWNER` | other `ROLE_*`. */
function toCanonicalRole(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  if (s.includes("ROLE_OWNER") || s === "OWNER") return "ROLE_OWNER";
  if (s.includes("ROLE_ADMIN")) return "ROLE_ADMIN";
  if (s.includes("ROLE_USER")) return "ROLE_USER";
  if (s === "ADMIN") return "ROLE_ADMIN";
  if (s === "USER") return "ROLE_USER";
  if (s.startsWith("ROLE_")) return s;
  return "";
}

function deriveRoleFromJwt(accessToken) {
  const payload = parseJwtPayload(accessToken);
  if (!payload || typeof payload !== "object") return "";
  const raw =
    normalizeRoleClaim(payload.role) ||
    normalizeRoleClaim(payload.roles) ||
    normalizeRoleClaim(payload.authorities) ||
    normalizeRoleClaim(payload.authority) ||
    normalizeRoleClaim(payload.scope) ||
    normalizeRoleClaim(payload.scp);
  return toCanonicalRole(raw);
}

function deriveRoleFromProfile(profile) {
  if (!profile || typeof profile !== "object") return "";
  const nested = profile.user && typeof profile.user === "object" ? profile.user : null;
  const raw =
    normalizeRoleClaim(profile.role) ||
    normalizeRoleClaim(nested?.role) ||
    normalizeRoleClaim(profile.roles) ||
    normalizeRoleClaim(profile.authorities) ||
    normalizeRoleClaim(profile.userRole);
  return toCanonicalRole(raw);
}

export function getInitials(name) {
  const value = String(name || "").trim();
  if (!value) return "U";
  const parts = value.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "U";
  const second = parts.length > 1 ? parts[1]?.[0] || "" : "";
  return (first + second).toUpperCase();
}

/**
 * Coalesce common API shapes so UI can rely on `name` / `email`.
 * (e.g. backend returns fullName but not name)
 */
export function normalizeProfilePayload(data) {
  if (!data || typeof data !== "object") return data;

  let merged = { ...data };
  const envelopeProfile =
    data.profile && typeof data.profile === "object" ? data.profile : null;
  if (envelopeProfile) {
    const p = envelopeProfile;
    merged = {
      ...merged,
      ...p,
      kyc: p.kyc ?? merged.kyc ?? data.kyc,
      kycRejectionReason:
        data.kycRejectionReason ??
        merged.kycRejectionReason ??
        p.kycRejectionReason ??
        p.kyc?.rejectionReason,
      kycStatus: data.kycStatus ?? merged.kycStatus ?? p.kycStatus ?? p.kyc?.status,
    };
    delete merged.profile;
  }

  const nestedUser =
    merged.user && typeof merged.user === "object" ? merged.user : null;
  const fromParts = [merged.firstName, merged.lastName].filter(Boolean).join(" ").trim();
  const coalescedName = String(
    merged.name ||
      merged.fullName ||
      merged.full_name ||
      fromParts ||
      merged.userName ||
      nestedUser?.name ||
      "",
  ).trim();
  const coalescedEmail = String(
    merged.email || nestedUser?.email || merged.userEmail || "",
  ).trim();
  const phoneRaw =
    merged.phoneNumber ??
    merged.phone ??
    merged.mobile ??
    merged.mobileNumber ??
    nestedUser?.phoneNumber ??
    "";
  const coalescedPhone = String(phoneRaw || "").trim();

  const nestedKyc =
    merged.kyc && typeof merged.kyc === "object" ? { ...merged.kyc } : null;

  const kycRejectionReason = String(
    envelopeProfile?.kyc?.rejectionReason ??
      nestedKyc?.rejectionReason ??
      merged.kycRejectionReason ??
      data.kycRejectionReason ??
      "",
  ).trim();

  if (nestedKyc && kycRejectionReason) {
    nestedKyc.rejectionReason = kycRejectionReason;
  }

  const kycStatus = String(
    data.kycStatus ?? merged.kycStatus ?? envelopeProfile?.kyc?.status ?? nestedKyc?.status ?? "",
  ).trim();

  return {
    ...merged,
    ...(coalescedName ? { name: coalescedName } : {}),
    ...(coalescedEmail ? { email: coalescedEmail } : {}),
    ...(coalescedPhone ? { phoneNumber: coalescedPhone } : {}),
    ...(nestedKyc ? { kyc: nestedKyc } : {}),
    ...(kycRejectionReason ? { kycRejectionReason } : {}),
    ...(kycStatus ? { kycStatus } : {}),
  };
}

/**
 * Greeting token: profile.name → nested user.name → email local-part → "" (caller shows "there").
 */
export function getGreetingFirstName(profile) {
  const n = String(profile?.name || "").trim();
  if (n) return n.split(/\s+/)[0];
  const u = String(profile?.user?.name || "").trim();
  if (u) return u.split(/\s+/)[0];
  const e = String(profile?.email || "").trim();
  if (e) return e.split("@")[0];
  return "";
}

function readCachedProfileFromStorage() {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return normalizeProfilePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * When `GET /profile` fails (e.g. backend `ProfileResponse$Kyc$KycBuilder` NoClassDefFoundError),
 * rebuild a minimal profile from JWT + cached `ui-profile` so the UI stays usable.
 */
export function composeProfileFromSession(cachedProfile = null) {
  const cached =
    cachedProfile && typeof cachedProfile === "object"
      ? normalizeProfilePayload(cachedProfile)
      : readCachedProfileFromStorage();

  const token = window.localStorage.getItem(TOKEN_KEY) || "";
  const payload = parseJwtPayload(token);
  const emailFromJwt = String(payload?.sub || "").trim();
  const userId =
    window.localStorage.getItem(USER_ID_KEY) ||
    String(payload?.userId ?? payload?.id ?? cached?.userId ?? cached?.id ?? "").trim();

  if (cached?.name || cached?.email || cached?.phoneNumber) {
    return normalizeProfilePayload({
      ...cached,
      ...(userId ? { userId, id: cached.id ?? userId } : {}),
      _profileDegraded: true,
    });
  }

  if (!emailFromJwt && !userId) return null;

  const localPart = emailFromJwt.includes("@") ? emailFromJwt.split("@")[0] : "";
  return normalizeProfilePayload({
    email: emailFromJwt,
    name: localPart || "User",
    ...(userId ? { userId, id: userId } : {}),
    _profileDegraded: true,
  });
}

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(() => {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    try {
      return normalizeProfilePayload(JSON.parse(raw));
    } catch {
      return null;
    }
  });

  /**
   * Single gate for “auth not ready”: first bootstrap (`GET /profile` + optional
   * role sync) and `onLoginSuccess` hydration. `ProtectedRoute` waits on this so
   * we never treat a transient empty `role` as an invalid session mid-hydration.
   */
  const [authLoading, setAuthLoading] = useState(true);

  /**
   * Token / role are tracked in React state (initialized from localStorage) so that
   * `onLoginSuccess` and `logout` trigger an AuthProvider re-render. Without this,
   * consumers like `ProtectedRoute` keep reading stale `token === ""` from the
   * memoized context value even after a successful admin verify-otp persisted the
   * JWT to `ui-access-token`, which caused an immediate redirect back to `/login`.
   */
  const [token, setToken] = useState(
    () => window.localStorage.getItem(TOKEN_KEY) || "",
  );
  const [role, setRole] = useState(
    () => window.localStorage.getItem(ROLE_KEY) || "",
  );

  const writeProfile = (nextProfile) => {
    if (!nextProfile) {
      window.localStorage.removeItem(PROFILE_KEY);
      return;
    }
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
  };

  const hydrateProfile = async () => {
    const currentToken = window.localStorage.getItem(TOKEN_KEY);
    if (!currentToken) {
      setProfile(null);
      writeProfile(null);
      return null;
    }
    try {
      const data = await profileBackend.getProfile();
      const next = data ? normalizeProfilePayload(data) : null;
      setProfile(next);
      writeProfile(next);
      /** If `ui-role` is missing (e.g. refresh after a backend that omits role on verify-otp), derive from profile once. */
      const fromProfile = deriveRoleFromProfile(next);
      if (fromProfile) {
        const existing = window.localStorage.getItem(ROLE_KEY) || "";
        if (!existing) {
          window.localStorage.setItem(ROLE_KEY, fromProfile);
          setRole(fromProfile);
        }
      }
      return next;
    } catch (err) {
      const fallback = composeProfileFromSession(profile);
      if (fallback) {
        setProfile(fallback);
        writeProfile(fallback);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            "[AuthContext] GET /profile failed; using session fallback.",
            err?.status,
            err?.message,
          );
        }
        return fallback;
      }
      throw err;
    }
  };

  const onLoginSuccess = async ({ token: nextToken, userId, role: nextRole }) => {
    const trimmed = typeof nextToken === "string" ? nextToken.trim() : nextToken;
    const trimmedToken = trimmed || "";
    const explicitRole = nextRole ? String(nextRole).trim() : "";

    setAuthLoading(true);
    try {
      // Clear stale auth state first to avoid old-token 403 issues.
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_ID_KEY);
      window.localStorage.removeItem(PROFILE_KEY);
      window.localStorage.removeItem(ROLE_KEY);

      if (trimmedToken) window.localStorage.setItem(TOKEN_KEY, trimmedToken);
      if (userId) window.localStorage.setItem(USER_ID_KEY, String(userId));

      setToken(trimmedToken);

      /**
       * Many verify-otp payloads omit `role` but the JWT still carries authorities.
       * Without `ui-role`, `ProtectedRoute` treated the session as corrupt and sent
       * users to "Session invalid" with a token present.
       */
      let effectiveRole =
        toCanonicalRole(explicitRole) || deriveRoleFromJwt(trimmedToken) || "";

      if (effectiveRole) window.localStorage.setItem(ROLE_KEY, effectiveRole);
      setRole(effectiveRole);

      cancelDebouncedDashboardInvalidate();
      invalidateDashboardBundleCache();
      invalidateRecentAppsCache();
      invalidateUsageTimeseriesCache();

      /**
       * Profile hydration is best-effort: `GET /profile` is a user-only endpoint and
       * rejects admin tokens, but admin login must still navigate to `/admin`.
       */
      try {
        const nextProfile = await hydrateProfile();
        const fromProfile = deriveRoleFromProfile(nextProfile);
        if (!effectiveRole && fromProfile) {
          effectiveRole = fromProfile;
          window.localStorage.setItem(ROLE_KEY, effectiveRole);
          setRole(effectiveRole);
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn(
            "[AuthContext] hydrateProfile after login failed; continuing with stored auth.",
            err?.status,
            err?.message,
          );
        }
      }

      if (!effectiveRole && trimmedToken) {
        effectiveRole = "ROLE_USER";
        window.localStorage.setItem(ROLE_KEY, effectiveRole);
        setRole(effectiveRole);
      }

      if (!trimmedToken) {
        window.localStorage.removeItem(ROLE_KEY);
        setRole("");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const updateUser = (patch) => {
    setProfile((prev) => {
      const next = normalizeProfilePayload({
        ...(prev || {}),
        ...(patch || {}),
      });
      writeProfile(next);
      return next;
    });
  };

  const logout = () => {
    cancelDebouncedDashboardInvalidate();
    invalidateDashboardBundleCache();
    invalidateRecentAppsCache();
    invalidateUsageTimeseriesCache();
    setProfile(null);
    setToken("");
    setRole("");
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_ID_KEY);
    window.localStorage.removeItem(PROFILE_KEY);
    window.localStorage.removeItem(ROLE_KEY);
    setAuthLoading(false);
  };

  useEffect(() => {
    setLogoutHandler(logout);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setAuthLoading(true);
      try {
        const t = window.localStorage.getItem(TOKEN_KEY);
        let r = window.localStorage.getItem(ROLE_KEY) || "";
        if (t && !r) {
          const derived = deriveRoleFromJwt(t);
          if (derived) {
            window.localStorage.setItem(ROLE_KEY, derived);
            if (active) setRole(derived);
            r = derived;
          }
        }
        try {
          await hydrateProfile();
        } catch {
          // If token exists but profile fetch fails, keep UI usable; pages can show errors.
        }
        if (
          active &&
          window.localStorage.getItem(TOKEN_KEY) &&
          !window.localStorage.getItem(ROLE_KEY)
        ) {
          const fallback = "ROLE_USER";
          window.localStorage.setItem(ROLE_KEY, fallback);
          setRole(fallback);
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      token,
      role,
      profile,
      authLoading,
      /** @deprecated Use `authLoading` — same value kept for existing callers. */
      initializing: authLoading,
      hydrateProfile,
      onLoginSuccess,
      updateProfile: updateUser,
      logout,
    }),
    [token, role, profile, authLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
