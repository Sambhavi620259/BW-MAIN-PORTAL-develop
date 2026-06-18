import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canAccessAdminPanel, normalizePanelRole } from "../utils/adminRoles";

function normalizeRole(value) {
  return normalizePanelRole(value) || "";
}

function pickSafeRedirectForRole(currentRole) {
  const r = normalizeRole(currentRole);

  if (canAccessAdminPanel(r)) return "/admin";
  if (r === "ROLE_USER") return "/dashboard";

  return "/login";
}

function roleSatisfiesRequired(current, expected) {
  const cur = normalizeRole(current);
  const exp = normalizeRole(expected);
  if (!exp) return true;
  if (cur === exp) return true;
  // OWNER may access admin-panel routes gated as ROLE_ADMIN until routes split further.
  if (exp === "ROLE_ADMIN" && cur === "ROLE_OWNER") return true;
  return false;
}

export default function ProtectedRoute({
  children,
  requiredRole,
  disallowRole,
}) {
  const {
    token,
    role,
    logout,
    authLoading,
  } = useAuth();

  const location = useLocation();

  // normalize roles FIRST
  const current = normalizeRole(role);
  const expected = normalizeRole(requiredRole);
  const disallowed = normalizeRole(disallowRole);

  // detect broken session
  const invalidSessionNeedsLogout =
    !authLoading &&
    Boolean(token) &&
    !current &&
    Boolean(expected || disallowed);

  // hooks ALWAYS before any return
  useEffect(() => {
    if (!invalidSessionNeedsLogout) return;

    if (typeof logout === "function") {
      logout();
    }
  }, [invalidSessionNeedsLogout, logout]);

  // loading
  if (authLoading) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#64748b",
        }}
      >
        Loading...
      </div>
    );
  }

  // no token
  if (!token) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          message: "Please login to continue",
          from: location.pathname,
        }}
      />
    );
  }

  // invalid session
  if (invalidSessionNeedsLogout) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          message: "Session invalid. Please login again.",
        }}
      />
    );
  }

  // disallowed role
  if (disallowed && current === disallowed) {
    const to = pickSafeRedirectForRole(current);

    if (location.pathname !== to) {
      return (
        <Navigate
          to={to}
          replace
          state={{
            message: "You do not have access to that page.",
          }}
        />
      );
    }

    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#64748b",
        }}
      >
        Access restricted.
      </div>
    );
  }

  // required role mismatch
  if (expected && !roleSatisfiesRequired(current, expected)) {
    const to = pickSafeRedirectForRole(current);

    if (location.pathname !== to) {
      return (
        <Navigate
          to={to}
          replace
          state={{
            message: "You do not have access to that page.",
          }}
        />
      );
    }

    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#64748b",
        }}
      >
        Access restricted.
      </div>
    );
  }

  return children;
}