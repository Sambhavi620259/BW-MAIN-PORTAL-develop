import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { useBrand } from "../context/BrandContext";
import "./Login.css";
import { useAuth } from "../context/AuthContext";
import { adminAuthBackend, authBackend } from "../services/backendApis";
import { getApiErrorMessage } from "../services/backendClient";
import { isAuthTokenDebugEnabled } from "../services/apiConfig";
import { showSuccess, showError } from "../services/toast";

/** Unwrap common backend shapes after `backendJson` envelope peel — trim once here. */
function extractVerifyOtpToken(data) {
  if (data == null || typeof data !== "object") return "";
  const nested =
    data.data && typeof data.data === "object" ? data.data : null;
  return String(
    data.token ??
      data.jwt ??
      data.accessToken ??
      data.access_token ??
      nested?.token ??
      nested?.jwt ??
      nested?.accessToken ??
      nested?.access_token ??
      "",
  ).trim();
}

function extractVerifyOtpRole(data) {
  if (data == null || typeof data !== "object") return "";
  const nested = data.data && typeof data.data === "object" ? data.data : null;
  const direct = data.role ?? nested?.role;
  if (direct != null && String(direct).trim())
    return String(direct).trim();
  const auth =
    data.authorities ??
    nested?.authorities ??
    data.roles ??
    nested?.roles;
  if (Array.isArray(auth) && auth.length) {
    const first = auth[0];
    if (typeof first === "string") return first.trim();
    if (first && typeof first === "object" && typeof first.authority === "string")
      return String(first.authority).trim();
  }
  return "";
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateOtp(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

export default function Login() {
  const { brand } = useBrand();
  const { onLoginSuccess } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [loginMode, setLoginMode] = useState("user"); // "user" | "admin"
  const [otpSent, setOtpSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState({ email: "", password: "", otp: "" });

  useEffect(() => {
    const msg = location.state?.message;
    if (typeof msg === "string" && msg.trim()) {
      setInfoMessage(msg.trim());
      navigate(location.pathname, { replace: true, state: null });
    }
  }, []);

  const canSubmitLogin =
    !loading && validateEmail(form.email) && form.password.trim().length > 0;

  const canSubmitOtp = !loading && validateOtp(form.otp);

  // ================= LOGIN (SEND OTP) =================
  const handleEmailLogin = async () => {
    setFormError("");
    setFieldErrors({});

    if (!validateEmail(form.email)) {
      setFieldErrors({ email: "Enter a valid email address." });
      return;
    }
    if (!form.password.trim()) {
      setFieldErrors({ password: "Password is required." });
      return;
    }

    setLoading(true);
    try {
      await authBackend.login({
        email: form.email.trim(),
        password: form.password,
      });

      localStorage.setItem("login_pending_email", form.email.trim());

      showSuccess("OTP sent to your email");
      setOtpSent(true);
    } catch (e) {
      const msg = e?.message?.toLowerCase().includes("verify")
        ? "Complete verification before login. Sign in with your password to receive a 6-digit code by email."
        : e?.message || "Login failed";
      setFormError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ================= ADMIN LOGIN (SEND OTP) =================
  const handleAdminLogin = async () => {
    setFormError("");
    setFieldErrors({});

    if (!validateEmail(form.email)) {
      setFieldErrors({ email: "Enter a valid email address." });
      return;
    }
    if (!form.password.trim()) {
      setFieldErrors({ password: "Password is required." });
      return;
    }

    setLoading(true);
    try {
      await adminAuthBackend.login({
        email: form.email.trim(),
        password: form.password,
      });

      localStorage.setItem("admin_login_pending_email", form.email.trim());

      showSuccess("OTP sent to your email");
      setOtpSent(true);
    } catch (e) {
      const status = e?.status;
      const rawMsg = getApiErrorMessage(e, "Admin login failed");
      const lower = rawMsg.toLowerCase();
      let msg = rawMsg;

      if (status === 403) {
        if (lower.includes("password")) msg = "Invalid admin password.";
        else msg = "Forbidden. Check admin credentials.";
      } else if (
        status === 401 ||
        (status === 500 && (lower.includes("invalid password") || lower.includes("unauthorized")))
      ) {
        msg =
          lower.includes("invalid password")
            ? "Invalid admin password. The server rejected the password for this admin email (or the account is not an admin on this environment)."
            : "Admin login was rejected by the server. Check that this email is an admin account on the backend.";
      } else if (lower.includes("admin not found")) {
        msg =
          "No admin account exists for this email. Use the admin email registered on the server, or ask your team to create or seed that admin user.";
      }

      setFormError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ================= VERIFY OTP =================
  const handleVerifyLoginOtp = async () => {
    setFormError("");
    setFieldErrors({});

    if (!validateOtp(form.otp)) {
      setFieldErrors({ otp: "OTP must be 6 digits." });
      return;
    }

    const email =
      localStorage.getItem("login_pending_email") || form.email.trim();

    setLoading(true);
    try {
      /* OTP must run without a stale JWT — backend rejects with "session expired" otherwise. */
      localStorage.removeItem("ui-access-token");
      localStorage.removeItem("ui-role");

      const data = await authBackend.verifyOtp({
        email,
        otp: form.otp.trim(),
      });
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("verify-otp response (dev only): keys", Object.keys(data || {}));
      }

      const token = extractVerifyOtpToken(data);
      const role = extractVerifyOtpRole(data);
      const userId = data?.userId ?? data?.data?.userId ?? "";

      if (!token) throw new Error("Invalid login response");

      if (isAuthTokenDebugEnabled()) {
        const storedBefore = localStorage.getItem("ui-access-token");
        /* eslint-disable no-console -- VITE_DEBUG_AUTH_TOKEN DEV-only */
        console.group("[AUTH DEBUG] verify-otp → token");
        console.log("response top-level keys:", Object.keys(data || {}));
        console.log("extracted JWT (exact):", token);
        console.log("JWT length:", token.length);
        console.log("token had whitespace-only trim applied:", true);
        console.log("localStorage ui-access-token before save:", storedBefore);
        console.groupEnd();
        /* eslint-enable no-console */
      }

      await onLoginSuccess({ token, userId, role });

      if (isAuthTokenDebugEnabled()) {
        const stored = localStorage.getItem("ui-access-token");
        // eslint-disable-next-line no-console
        console.log("[AUTH DEBUG] after onLoginSuccess — stored === extracted:", stored === token);
        if (stored !== token) {
          console.warn("[AUTH DEBUG] token mismatch after save", {
            extractedLen: token.length,
            storedLen: stored?.length ?? 0,
          });
        }
      }

      localStorage.removeItem("login_pending_email");

      showSuccess("Login successful");
      /** Navigate after token + profile hydrate complete — avoids racing global 401 handlers. */
      const normalizedRole = String(role || "").toUpperCase();
      if (normalizedRole === "ROLE_ADMIN" || normalizedRole === "ROLE_OWNER") {
        navigate("/admin");
      } else {
        navigate("/dashboard");
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("verify-otp error (dev only):", e?.status, e?.message);
      }
      const p = e?.payload;
      const nested =
        p && typeof p === "object" && typeof p.data === "object" && p.data?.message;
      const msg =
        (typeof nested === "string" && nested) ||
        e?.message ||
        (p && typeof p === "object" && typeof p.error === "string" && p.error) ||
        "Invalid OTP";
      setFormError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ================= ADMIN VERIFY OTP =================
  const handleVerifyAdminOtp = async () => {
    setFormError("");
    setFieldErrors({});

    if (!validateOtp(form.otp)) {
      setFieldErrors({ otp: "OTP must be 6 digits." });
      return;
    }

    const email =
      localStorage.getItem("admin_login_pending_email") || form.email.trim();

    setLoading(true);
    try {
      /* OTP must run without a stale JWT — backend rejects with "session expired" otherwise. */
      localStorage.removeItem("ui-access-token");
      localStorage.removeItem("ui-role");

      const data = await adminAuthBackend.verifyOtp({
        email,
        otp: form.otp.trim(),
      });

      // Defensive parsing: backend may return token/role at root OR wrapped in `data`.
      // Supports both:
      // - { data: { token, role } }
      // - { token, role }
      const token =
        extractVerifyOtpToken(data) ?? data?.token ?? data?.data?.token ?? "";
      const role = data?.role ?? data?.data?.role ?? "ROLE_ADMIN";
      const userId = data?.userId ?? data?.data?.userId ?? "";

      if (!token) throw new Error("Invalid login response");

      await onLoginSuccess({ token, userId, role });

      localStorage.removeItem("admin_login_pending_email");

      showSuccess("Admin login successful");
      navigate("/admin");
    } catch (e) {
      const status = e?.status;
      const rawMsg = getApiErrorMessage(e, "Invalid OTP");
      let msg = rawMsg;
      if (status === 403) msg = rawMsg || "Forbidden. Invalid OTP or unauthorized.";
      setFormError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  const pendingEmailKey =
    loginMode === "admin" ? "admin_login_pending_email" : "login_pending_email";
  const pendingEmail =
    localStorage.getItem(pendingEmailKey) || form.email;

  return (
    <div className="login-page">
      {/* Left Branding Panel */}
      <aside className="login-left-panel">
        <div className="login-left-top">
          <Logo to="/" showText />
        </div>
        <div className="login-left-middle">
          <h1 className="login-left-title">Welcome Back!</h1>
          <p className="login-left-desc">
            Sign in to access your dashboard, manage apps, and stay connected.
          </p>
          <div className="login-features">
            <div className="login-feature-item">
              <span className="login-feature-icon">🚀</span>
              <div>
                <span className="login-feature-label">Fast & Secure</span>
                <span className="login-feature-sub">
                  Enterprise-grade security
                </span>
              </div>
            </div>
            <div className="login-feature-item">
              <span className="login-feature-icon">📊</span>
              <div>
                <span className="login-feature-label">Real-time Dashboard</span>
                <span className="login-feature-sub">
                  Monitor your activity live
                </span>
              </div>
            </div>
            <div className="login-feature-item">
              <span className="login-feature-icon">🛡️</span>
              <div>
                <span className="login-feature-label">KYC Verified</span>
                <span className="login-feature-sub">
                  Trusted & compliant platform
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Right Form Panel */}
      <main className="login-right-panel">
        <div className="login-form-wrapper">
          <div className="login-right-header">
            <h2 className="login-right-title">
              {otpSent ? "Verify OTP" : "Sign In"}
            </h2>
            <p className="login-right-sub">
              {otpSent
                ? "Enter the 6-digit OTP sent to your email."
                : "Enter your credentials to continue."}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              className={`btn ${loginMode === "user" ? "btn-primary" : ""}`}
              onClick={() => {
                if (loginMode === "user") return;
                setLoginMode("user");
                setOtpSent(false);
                setForm((p) => ({ ...p, otp: "" }));
                setFieldErrors({});
                setFormError("");
                localStorage.removeItem("admin_login_pending_email");
              }}
              disabled={loading}
              aria-pressed={loginMode === "user"}
            >
              User Login
            </button>
            <button
              type="button"
              className={`btn ${loginMode === "admin" ? "btn-primary" : ""}`}
              onClick={() => {
                if (loginMode === "admin") return;
                setLoginMode("admin");
                setOtpSent(false);
                setForm((p) => ({ ...p, otp: "" }));
                setFieldErrors({});
                setFormError("");
                localStorage.removeItem("login_pending_email");
              }}
              disabled={loading}
              aria-pressed={loginMode === "admin"}
            >
              Admin Login
            </button>
          </div>

          {infoMessage && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#eef2ff",
                color: "#3730a3",
                fontSize: 14,
              }}
            >
              {infoMessage}
            </div>
          )}

          {formError && <div className="login-error">{formError}</div>}

          {/* ================= EMAIL + PASSWORD ================= */}
          {!otpSent && (
            <form
              className="login-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (loginMode === "admin") {
                  handleAdminLogin();
                } else {
                  handleEmailLogin();
                }
              }}
            >
              <div className="login-input-block">
                <label className="login-label" htmlFor="login-email">
                  Email Address
                </label>
                <div
                  className={`login-input-with-icon ${fieldErrors.email ? "login-input-invalid" : ""}`}
                >
                  <span className="login-input-icon" aria-hidden>
                    ✉️
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    className="input login-premium-input"
                    placeholder="you@company.com"
                    value={form.email}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, email: e.target.value }))
                    }
                  />
                </div>
                {fieldErrors.email && (
                  <div className="login-field-error">{fieldErrors.email}</div>
                )}
              </div>

              <div className="login-input-block">
                <label className="login-label" htmlFor="login-password">
                  Password
                </label>
                <div
                  className={`login-input-with-icon ${fieldErrors.password ? "login-input-invalid" : ""}`}
                >
                  <span className="login-input-icon" aria-hidden>
                    🔒
                  </span>
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    className="input login-premium-input"
                    placeholder="Enter your password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, password: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setShowPassword((p) => !p)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
                {fieldErrors.password && (
                  <div className="login-field-error">
                    {fieldErrors.password}
                  </div>
                )}
              </div>

              <div className="login-options-row">
                <label className="login-remember">
                  <input type="checkbox" />
                  <span>Remember me</span>
                </label>
                <button
                  type="button"
                  className="login-forgot"
                  onClick={() => navigate("/forgot-password")}
                >
                  Forgot Password?
                </button>
              </div>

              <button
                type="submit"
                className="btn btn-primary login-submit-btn"
                disabled={!canSubmitLogin}
              >
                {loading ? (
                  <>
                    <span className="login-btn-spinner" aria-hidden />
                    Sending OTP...
                  </>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>
          )}

          {/* ================= OTP VERIFY ================= */}
          {otpSent && (
            <form
              className="login-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (loginMode === "admin") {
                  handleVerifyAdminOtp();
                } else {
                  handleVerifyLoginOtp();
                }
              }}
            >
              <p className="login-otp-hint">
                OTP sent to{" "}
                <strong>
                  {pendingEmail}
                </strong>
              </p>

              <div className="login-input-block">
                <label className="login-label" htmlFor="login-otp">
                  OTP
                </label>
                <div
                  className={`login-input-with-icon ${fieldErrors.otp ? "login-input-invalid" : ""}`}
                >
                  <span className="login-input-icon" aria-hidden>
                    🔑
                  </span>
                  <input
                    id="login-otp"
                    type="text"
                    inputMode="numeric"
                    className="input login-premium-input"
                    placeholder="Enter 6-digit OTP"
                    value={form.otp}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, otp: e.target.value }))
                    }
                  />
                </div>
                {fieldErrors.otp && (
                  <div className="login-field-error">{fieldErrors.otp}</div>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary login-submit-btn"
                disabled={!canSubmitOtp}
              >
                {loading ? (
                  <>
                    <span className="login-btn-spinner" aria-hidden />
                    Verifying...
                  </>
                ) : (
                  "Verify & Login"
                )}
              </button>

              <button
                type="button"
                className="login-change-email-btn"
                onClick={() => {
                  setOtpSent(false);
                  setForm((p) => ({ ...p, otp: "" }));
                  setFieldErrors({});
                  setFormError("");
                  localStorage.removeItem(pendingEmailKey);
                }}
                disabled={loading}
              >
                ← Change email
              </button>
            </form>
          )}

          <p className="login-signup-prompt">
            Don't have an account?{" "}
            <Link to="/register" className="login-signup-link">
              Sign Up
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
