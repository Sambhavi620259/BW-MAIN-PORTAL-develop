import { useCallback, useEffect, useMemo, useState } from "react";
import { adminInviteBackend } from "../services/adminInviteBackend";
import { getApiErrorMessage } from "../services/backendClient";
import { showError, showSuccess } from "../services/toast";
import { canInviteOwnerRole } from "../utils/adminRoles";

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateOtp(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

/**
 * Two-step modal: (1) invite details → request OTP, (2) verify OTP → create invite.
 * OTP is sent to the logged-in inviter's email via backend (reuses existing OTP infra).
 */
export default function AdminInviteModal({
  open,
  onClose,
  inviterRole,
  inviterEmail,
  onInviteSent,
}) {
  const [step, setStep] = useState("details");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("ADMIN");
  const [otp, setOtp] = useState("");
  const [inviteActionToken, setInviteActionToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const allowOwnerRole = canInviteOwnerRole(inviterRole);

  const resetForm = useCallback(() => {
    setStep("details");
    setFullName("");
    setEmail("");
    setRole("ADMIN");
    setOtp("");
    setInviteActionToken("");
    setFieldErrors({});
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const maskedInviterEmail = useMemo(() => {
    const e = String(inviterEmail || "").trim();
    if (!e || !e.includes("@")) return "your admin email";
    const [local, domain] = e.split("@");
    const masked =
      local.length <= 2 ? `${local[0] || ""}*` : `${local.slice(0, 2)}***`;
    return `${masked}@${domain}`;
  }, [inviterEmail]);

  const validateDetails = () => {
    const errs = {};
    if (!String(fullName || "").trim()) errs.fullName = "Full name is required.";
    if (!validateEmail(email)) errs.email = "Enter a valid email address.";
    if (!["ADMIN", "OWNER"].includes(role)) errs.role = "Invalid role.";
    if (role === "OWNER" && !allowOwnerRole) {
      errs.role = "Only an existing owner can invite another owner.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleRequestOtp = async () => {
    if (!validateDetails()) return;
    setLoading(true);
    setFieldErrors({});
    try {
      await adminInviteBackend.requestOtp();
      setStep("otp");
      showSuccess(`OTP sent to ${maskedInviterEmail}`);
    } catch (err) {
      showError(getApiErrorMessage(err, "Could not send OTP. Try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndInvite = async () => {
    const otpVal = String(otp || "").trim();
    if (!validateOtp(otpVal)) {
      setFieldErrors({ otp: "OTP must be 6 digits." });
      return;
    }
    setLoading(true);
    setFieldErrors({});
    try {
      const verifyRes = await adminInviteBackend.verifyOtp({ otp: otpVal });
      const token =
        verifyRes?.data?.inviteActionToken ??
        verifyRes?.inviteActionToken ??
        verifyRes?.data?.token ??
        verifyRes?.token ??
        "";
      if (!token) {
        throw new Error("OTP verified but invite authorization missing. Contact support.");
      }
      setInviteActionToken(token);
      await adminInviteBackend.createInvite({
        fullName: String(fullName).trim(),
        email: String(email).trim().toLowerCase(),
        role,
        inviteActionToken: token,
      });
      showSuccess(`Invitation sent to ${email.trim()}`);
      setInviteActionToken("");
      onInviteSent?.();
      onClose?.();
    } catch (err) {
      showError(getApiErrorMessage(err, "Could not create invitation."));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="kyc-mod-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose?.();
      }}
    >
      <div className="kyc-mod-modal admin-invite-modal" role="dialog" aria-modal="true">
        <h3 className="kyc-mod-modal-title">
          {step === "details" ? "Invite admin" : "Verify OTP"}
        </h3>
        <p className="admin-invite-modal-sub">
          {step === "details"
            ? "Invite a new admin. You will verify with a one-time code sent to your email before the invite is created."
            : `Enter the 6-digit code sent to ${maskedInviterEmail}.`}
        </p>

        {step === "details" ? (
          <div className="admin-invite-form">
            <label className="admin-invite-label">
              Full name
              <input
                type="text"
                className="admin-invite-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={loading}
                autoComplete="name"
              />
              {fieldErrors.fullName ? (
                <span className="admin-invite-error">{fieldErrors.fullName}</span>
              ) : null}
            </label>
            <label className="admin-invite-label">
              Email
              <input
                type="email"
                className="admin-invite-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
              />
              {fieldErrors.email ? (
                <span className="admin-invite-error">{fieldErrors.email}</span>
              ) : null}
            </label>
            <label className="admin-invite-label">
              Role
              <select
                className="admin-invite-input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={loading}
              >
                <option value="ADMIN">ADMIN</option>
                {allowOwnerRole ? <option value="OWNER">OWNER</option> : null}
              </select>
              {fieldErrors.role ? (
                <span className="admin-invite-error">{fieldErrors.role}</span>
              ) : null}
            </label>
          </div>
        ) : (
          <div className="admin-invite-form">
            <label className="admin-invite-label">
              OTP
              <input
                type="text"
                inputMode="numeric"
                className="admin-invite-input"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit code"
                disabled={loading}
                maxLength={6}
              />
              {fieldErrors.otp ? (
                <span className="admin-invite-error">{fieldErrors.otp}</span>
              ) : null}
            </label>
            <button
              type="button"
              className="admin-invite-link-btn"
              disabled={loading}
              onClick={() => void handleRequestOtp()}
            >
              Resend OTP
            </button>
          </div>
        )}

        <div className="kyc-mod-modal-actions">
          <button
            type="button"
            className="kyc-mod-btn ghost"
            disabled={loading}
            onClick={() => {
              if (step === "otp" && !loading) {
                setStep("details");
                setOtp("");
                return;
              }
              onClose?.();
            }}
          >
            {step === "otp" ? "Back" : "Cancel"}
          </button>
          <button
            type="button"
            className="kyc-mod-btn primary"
            disabled={loading}
            onClick={() =>
              void (step === "details" ? handleRequestOtp() : handleVerifyAndInvite())
            }
          >
            {loading
              ? "Please wait…"
              : step === "details"
                ? "Send OTP & continue"
                : "Verify & send invite"}
          </button>
        </div>
      </div>
    </div>
  );
}
