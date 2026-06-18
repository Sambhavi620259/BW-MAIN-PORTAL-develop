import { useEffect, useMemo, useState } from "react";
import { adminRoleBackend } from "../services/adminRoleBackend";
import { getApiErrorMessage } from "../services/backendClient";
import { showError, showSuccess } from "../services/toast";
import AdminUserRoleBadge from "./AdminUserRoleBadge";
import {
  extractRowPanelRole,
  getAllowedTargetRoles,
  getRoleChangeConfirmation,
  isLastOwnerTarget,
  isRoleChangeAllowed,
  isSameUserRow,
  toApiRole,
} from "../utils/adminRoles";
import "../pages/AdminInviteAccept.css";

function validateOtp(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

/**
 * Pick (optional) → confirm → OTP → PATCH role.
 * Role selection happens inside the modal, not in table rows.
 */
export default function AdminRoleChangeModal({
  open,
  onClose,
  targetUser,
  toRole = "",
  actorRole,
  allRows = [],
  actorProfile,
  actorEmail,
  onRoleChanged,
}) {
  const [step, setStep] = useState("pick");
  const [pickedRole, setPickedRole] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const fromRole = useMemo(
    () => (targetUser ? extractRowPanelRole(targetUser) : "USER"),
    [targetUser],
  );

  const pickContext = useMemo(
    () => ({
      isSelf: targetUser ? isSameUserRow(actorProfile, targetUser) : false,
      isLastOwnerTarget: targetUser
        ? isLastOwnerTarget(targetUser, allRows)
        : false,
    }),
    [actorProfile, allRows, targetUser],
  );

  const pickableRoles = useMemo(() => {
    const allowed = getAllowedTargetRoles(actorRole, fromRole, pickContext);
    return allowed.filter((r) => r !== fromRole);
  }, [actorRole, fromRole, pickContext]);

  const presetRole = toApiRole(toRole);
  const hasPresetRole = Boolean(presetRole && presetRole !== fromRole);
  const nextRole = hasPresetRole ? presetRole : toApiRole(pickedRole);

  const displayName =
    targetUser?.displayName || targetUser?.name || targetUser?.email || "User";
  const targetUserId = String(
    targetUser?.userId || targetUser?.id || "",
  ).trim();

  useEffect(() => {
    if (!open) {
      setStep("pick");
      setPickedRole("");
      setOtp("");
      setFieldErrors({});
      setLoading(false);
      return;
    }
    setStep(hasPresetRole ? "confirm" : "pick");
    setPickedRole("");
    setOtp("");
    setFieldErrors({});
    setLoading(false);
  }, [open, hasPresetRole, targetUser?.id]);

  const maskedActorEmail = useMemo(() => {
    const e = String(actorEmail || "").trim();
    if (!e || !e.includes("@")) return "your admin email";
    const [local, domain] = e.split("@");
    const masked =
      local.length <= 2 ? `${local[0] || ""}*` : `${local.slice(0, 2)}***`;
    return `${masked}@${domain}`;
  }, [actorEmail]);

  const confirmationText = getRoleChangeConfirmation(
    fromRole,
    nextRole,
    displayName,
  );

  const handlePickContinue = () => {
    const roleVal = toApiRole(pickedRole);
    if (!roleVal || roleVal === fromRole) {
      setFieldErrors({ role: "Select a new role." });
      return;
    }
    if (!isRoleChangeAllowed(actorRole, fromRole, roleVal, pickContext)) {
      showError("This role change is not permitted.");
      return;
    }
    setFieldErrors({});
    setStep("confirm");
  };

  const handleRequestOtp = async () => {
    if (!nextRole || nextRole === fromRole) {
      showError("Select a valid new role.");
      return;
    }
    setLoading(true);
    setFieldErrors({});
    try {
      await adminRoleBackend.requestOtp();
      setStep("otp");
      showSuccess(`OTP sent to ${maskedActorEmail}`);
    } catch (err) {
      showError(getApiErrorMessage(err, "Could not send OTP. Try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndApply = async () => {
    const otpVal = String(otp || "").trim();
    if (!validateOtp(otpVal)) {
      setFieldErrors({ otp: "OTP must be 6 digits." });
      return;
    }
    if (!targetUserId) {
      showError("User identifier missing. Refresh and try again.");
      return;
    }
    setLoading(true);
    setFieldErrors({});
    try {
      const verifyRes = await adminRoleBackend.verifyOtp({ otp: otpVal });
      const token =
        verifyRes?.data?.roleChangeActionToken ??
        verifyRes?.roleChangeActionToken ??
        verifyRes?.data?.token ??
        verifyRes?.token ??
        "";
      if (!token) {
        throw new Error(
          "OTP verified but role-change authorization missing. Contact support.",
        );
      }
      await adminRoleBackend.updateUserRole(targetUserId, {
        role: nextRole,
        roleChangeActionToken: token,
      });
      showSuccess(`${displayName} is now ${nextRole}`);
      onRoleChanged?.();
      onClose?.();
    } catch (err) {
      showError(
        getApiErrorMessage(err, "Could not update role. Try again."),
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open || !targetUser) return null;

  const stepTitle =
    step === "pick"
      ? "Manage role"
      : step === "confirm"
        ? "Confirm role change"
        : "Verify OTP";

  return (
    <div
      className="kyc-mod-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose?.();
      }}
    >
      <div
        className="kyc-mod-modal admin-invite-modal admin-role-change-modal"
        role="dialog"
        aria-modal="true"
      >
        <h3 className="kyc-mod-modal-title">{stepTitle}</h3>
        <p className="admin-invite-modal-sub">
          {step === "pick"
            ? `Choose a new role for ${displayName}. Current role:`
            : step === "confirm"
              ? confirmationText
              : `Enter the 6-digit code sent to ${maskedActorEmail} to confirm changing ${displayName} from ${fromRole} to ${nextRole}.`}
        </p>

        {step === "pick" ? (
          <div className="admin-invite-form">
            <div className="admin-role-change-current">
              <AdminUserRoleBadge role={fromRole} />
            </div>
            <label className="admin-invite-label">
              New role
              <select
                className="admin-invite-input"
                value={pickedRole}
                onChange={(e) => setPickedRole(e.target.value)}
                disabled={loading}
              >
                <option value="">Select role…</option>
                {pickableRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {fieldErrors.role ? (
                <span className="admin-invite-error">{fieldErrors.role}</span>
              ) : null}
            </label>
          </div>
        ) : null}

        {step === "otp" ? (
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
        ) : null}

        {step === "confirm" ? (
          <p className="admin-role-change-summary">
            <strong>{fromRole}</strong>
            <span aria-hidden> → </span>
            <strong>{nextRole}</strong>
          </p>
        ) : null}

        <div className="kyc-mod-modal-actions">
          <button
            type="button"
            className="kyc-mod-btn ghost"
            disabled={loading}
            onClick={() => {
              if (step === "otp" && !loading) {
                setStep("confirm");
                setOtp("");
                return;
              }
              if (step === "confirm" && !hasPresetRole && !loading) {
                setStep("pick");
                return;
              }
              onClose?.();
            }}
          >
            {step === "otp" ? "Back" : step === "confirm" && !hasPresetRole ? "Back" : "Cancel"}
          </button>
          <button
            type="button"
            className="kyc-mod-btn primary"
            disabled={loading || (step === "confirm" && (!nextRole || nextRole === fromRole))}
            onClick={() => {
              if (step === "pick") void handlePickContinue();
              else if (step === "confirm") void handleRequestOtp();
              else void handleVerifyAndApply();
            }}
          >
            {loading
              ? "Please wait…"
              : step === "pick"
                ? "Continue"
                : step === "confirm"
                  ? "Send OTP & continue"
                  : "Verify & apply role"}
          </button>
        </div>
      </div>
    </div>
  );
}
