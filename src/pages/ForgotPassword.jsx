import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { passwordBackend } from "../services/backendApis";
import { showError, showSuccess } from "../services/toast";

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateOtp(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function validatePassword(value) {
  return String(value || "").trim().length >= 6;
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState("email"); // email | reset
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    email: "",
    otp: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});

  const canSend =
    !loading && validateEmail(form.email) && String(form.email).trim().length > 3;

  const canReset = useMemo(() => {
    if (loading) return false;
    if (!validateEmail(form.email)) return false;
    if (!validateOtp(form.otp)) return false;
    if (!validatePassword(form.newPassword)) return false;
    if (form.newPassword !== form.confirmPassword) return false;
    return true;
  }, [form, loading]);

  const sendOtp = async () => {
    setError("");
    setFieldErrors({});
    const email = String(form.email || "").trim();
    if (!validateEmail(email)) {
      setFieldErrors({ email: "Enter a valid email address." });
      return;
    }

    setLoading(true);
    try {
      await passwordBackend.forgotPassword(email);
      showSuccess("OTP sent to your email");
      setStep("reset");
    } catch (e) {
      const msg = e?.message || "Failed to send OTP";
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError("");
    setFieldErrors({});

    const email = String(form.email || "").trim();
    const otp = String(form.otp || "").trim();
    const newPassword = String(form.newPassword || "");
    const confirmPassword = String(form.confirmPassword || "");

    const errs = {};
    if (!validateEmail(email)) errs.email = "Enter a valid email address.";
    if (!validateOtp(otp)) errs.otp = "OTP must be 6 digits.";
    if (!validatePassword(newPassword))
      errs.newPassword = "Password must be at least 6 characters.";
    if (newPassword !== confirmPassword)
      errs.confirmPassword = "Passwords do not match.";

    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    try {
      await passwordBackend.resetPassword({ email, otp, newPassword });
      showSuccess("Password reset successful. Please login.");
      navigate("/login", {
        replace: true,
        state: { message: "Password updated. Please sign in." },
      });
    } catch (e) {
      const msg = e?.message || "Failed to reset password";
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 18,
        background:
          "radial-gradient(circle at top right, rgba(37,99,235,0.16), transparent 50%), radial-gradient(circle at bottom left, rgba(14,165,233,0.12), transparent 45%), linear-gradient(135deg, #f8fbff 0%, #eef2ff 40%, #ffffff 100%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
          <Logo to="/login" showText />
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(37,99,235,0.14)",
            boxShadow: "0 28px 70px rgba(15,23,42,0.18)",
            borderRadius: 18,
            padding: 22,
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.2px" }}>
              {step === "email" ? "Forgot password" : "Reset password"}
            </h1>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
              {step === "email"
                ? "Enter your email and we’ll send you a one-time code."
                : "Enter the OTP and choose a new password."}
            </p>
          </div>

          {error ? (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#fff1f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (step === "email") void sendOtp();
              else void resetPassword();
            }}
            style={{ display: "grid", gap: 12 }}
          >
            <div>
              <label style={labelStyle} htmlFor="fp-email">
                Email
              </label>
              <input
                id="fp-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="you@company.com"
                style={inputStyle(Boolean(fieldErrors.email))}
                disabled={loading || step === "reset"}
              />
              {fieldErrors.email ? (
                <div style={fieldErrorStyle}>{fieldErrors.email}</div>
              ) : null}
            </div>

            {step === "reset" ? (
              <>
                <div>
                  <label style={labelStyle} htmlFor="fp-otp">
                    OTP
                  </label>
                  <input
                    id="fp-otp"
                    type="text"
                    inputMode="numeric"
                    value={form.otp}
                    onChange={(e) => setForm((p) => ({ ...p, otp: e.target.value }))}
                    placeholder="6-digit OTP"
                    style={inputStyle(Boolean(fieldErrors.otp))}
                    disabled={loading}
                  />
                  {fieldErrors.otp ? (
                    <div style={fieldErrorStyle}>{fieldErrors.otp}</div>
                  ) : null}
                </div>

                <div>
                  <label style={labelStyle} htmlFor="fp-newpw">
                    New password
                  </label>
                  <input
                    id="fp-newpw"
                    type="password"
                    value={form.newPassword}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, newPassword: e.target.value }))
                    }
                    placeholder="Minimum 6 characters"
                    style={inputStyle(Boolean(fieldErrors.newPassword))}
                    disabled={loading}
                  />
                  {fieldErrors.newPassword ? (
                    <div style={fieldErrorStyle}>{fieldErrors.newPassword}</div>
                  ) : null}
                </div>

                <div>
                  <label style={labelStyle} htmlFor="fp-confirmpw">
                    Confirm password
                  </label>
                  <input
                    id="fp-confirmpw"
                    type="password"
                    value={form.confirmPassword}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, confirmPassword: e.target.value }))
                    }
                    placeholder="Re-enter new password"
                    style={inputStyle(Boolean(fieldErrors.confirmPassword))}
                    disabled={loading}
                  />
                  {fieldErrors.confirmPassword ? (
                    <div style={fieldErrorStyle}>{fieldErrors.confirmPassword}</div>
                  ) : null}
                </div>
              </>
            ) : null}

            <button
              type="submit"
              disabled={step === "email" ? !canSend : !canReset}
              style={{
                border: "none",
                borderRadius: 14,
                padding: "12px 14px",
                fontWeight: 950,
                cursor: loading ? "not-allowed" : "pointer",
                background:
                  "linear-gradient(135deg, rgba(37,99,235,1), rgba(29,78,216,1))",
                color: "#fff",
                boxShadow: "0 14px 34px rgba(37,99,235,0.28)",
                opacity: step === "email" ? (canSend ? 1 : 0.55) : canReset ? 1 : 0.55,
              }}
            >
              {loading
                ? step === "email"
                  ? "Sending OTP..."
                  : "Resetting..."
                : step === "email"
                  ? "Send OTP"
                  : "Reset password"}
            </button>

            {step === "reset" ? (
              <button
                type="button"
                onClick={() => setStep("email")}
                disabled={loading}
                style={secondaryBtnStyle}
              >
                ← Change email
              </button>
            ) : null}
          </form>

          <div style={{ marginTop: 14, textAlign: "center", fontSize: 13 }}>
            <Link to="/login" style={{ color: "#2563eb", fontWeight: 800 }}>
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block",
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 900,
  color: "#0f172a",
};

const fieldErrorStyle = {
  marginTop: 6,
  color: "#b91c1c",
  fontSize: 12,
  fontWeight: 700,
};

const inputStyle = (invalid) => ({
  width: "100%",
  borderRadius: 14,
  border: `1px solid ${invalid ? "#fecaca" : "rgba(148,163,184,0.6)"}`,
  padding: "12px 12px",
  outline: "none",
  background: "#fff",
  boxShadow: invalid ? "0 0 0 3px rgba(239,68,68,0.12)" : "none",
});

const secondaryBtnStyle = {
  borderRadius: 14,
  padding: "12px 14px",
  fontWeight: 900,
  cursor: "pointer",
  background: "#ffffff",
  color: "#2563eb",
  border: "1px solid rgba(37,99,235,0.28)",
};

