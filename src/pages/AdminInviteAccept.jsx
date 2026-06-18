import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Logo from "../components/Logo";
import { adminInviteBackend } from "../services/adminInviteBackend";
import { getApiErrorMessage } from "../services/backendClient";
import { showError, showSuccess } from "../services/toast";
import "./AdminInviteAccept.css";

function validatePassword(value) {
  return String(value || "").trim().length >= 6;
}

/**
 * Public route: invited admin sets password and completes onboarding.
 * Token is read from URL only — never logged.
 */
export default function AdminInviteAccept() {
  const { token: routeToken } = useParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState("loading");
  const [inviteMeta, setInviteMeta] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const token = useMemo(
    () => String(routeToken || "").trim(),
    [routeToken],
  );

  useEffect(() => {
    if (!token) {
      setPhase("invalid");
      setLoadError("Invite link is invalid.");
      return;
    }
    let alive = true;
    setPhase("loading");
    setLoadError("");
    adminInviteBackend
      .getInvite(token)
      .then((data) => {
        if (!alive) return;
        const meta = data && typeof data === "object" ? data : {};
        setInviteMeta({
          email: meta.email || meta.inviteeEmail || "",
          fullName: meta.fullName || meta.name || "",
          role: meta.role || "ADMIN",
          expiresAt: meta.expiresAt || null,
        });
        setPhase("ready");
      })
      .catch((err) => {
        if (!alive) return;
        const msg = getApiErrorMessage(err, "This invite link is invalid or expired.");
        setLoadError(msg);
        setPhase("invalid");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const submitSetup = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!validatePassword(password)) {
      errs.password = "Password must be at least 6 characters.";
    }
    if (password !== confirmPassword) {
      errs.confirmPassword = "Passwords do not match.";
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      await adminInviteBackend.completeInvite({
        token,
        password,
      });
      showSuccess("Admin account ready. Please sign in.");
      navigate("/login", {
        replace: true,
        state: {
          message: "Admin setup complete. Sign in with your new password.",
          adminMode: true,
        },
      });
    } catch (err) {
      showError(getApiErrorMessage(err, "Could not complete setup."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-invite-accept-page">
      <div className="admin-invite-accept-card">
        <div className="admin-invite-accept-logo">
          <Logo to="/login" showText />
        </div>

        {phase === "loading" ? (
          <p className="admin-invite-accept-muted">Validating invite…</p>
        ) : null}

        {phase === "invalid" ? (
          <>
            <h1>Invite unavailable</h1>
            <p className="admin-invite-accept-error">{loadError}</p>
            <Link to="/login" className="admin-invite-accept-link">
              Go to login
            </Link>
          </>
        ) : null}

        {phase === "ready" ? (
          <>
            <h1>Complete admin setup</h1>
            <p className="admin-invite-accept-muted">
              {inviteMeta?.fullName
                ? `Welcome, ${inviteMeta.fullName}.`
                : "Set your password to activate your admin account."}
            </p>
            {inviteMeta?.email ? (
              <p className="admin-invite-accept-email">
                Account: <strong>{inviteMeta.email}</strong>
                {inviteMeta.role ? (
                  <span className="admin-invite-accept-role"> ({inviteMeta.role})</span>
                ) : null}
              </p>
            ) : null}

            <form className="admin-invite-accept-form" onSubmit={(ev) => void submitSetup(ev)}>
              <label className="admin-invite-label">
                New password
                <input
                  type="password"
                  className="admin-invite-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  disabled={submitting}
                  autoComplete="new-password"
                />
                {fieldErrors.password ? (
                  <span className="admin-invite-error">{fieldErrors.password}</span>
                ) : null}
              </label>
              <label className="admin-invite-label">
                Confirm password
                <input
                  type="password"
                  className="admin-invite-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                  autoComplete="new-password"
                />
                {fieldErrors.confirmPassword ? (
                  <span className="admin-invite-error">{fieldErrors.confirmPassword}</span>
                ) : null}
              </label>
              <button
                type="submit"
                className="admin-invite-accept-submit"
                disabled={submitting}
              >
                {submitting ? "Setting up…" : "Complete setup"}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
