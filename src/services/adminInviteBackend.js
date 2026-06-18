import { backendJson } from "./backendClient";

/**
 * Admin invitation API — backend team implements these routes.
 * All invite-creation routes require authenticated ADMIN/OWNER JWT.
 * Token validation + completion are public (no Bearer).
 */
export const adminInviteBackend = {
  /** POST /admin/invite/request-otp — sends OTP to the logged-in inviter's email. */
  requestOtp() {
    return backendJson("/admin/invite/request-otp", {
      method: "POST",
      json: {},
      suppressGlobalServerErrorToast: true,
    });
  },

  /**
   * POST /admin/invite/verify-otp
   * @param {{ otp: string }} body
   * @returns inviteActionToken (short-lived, single-use)
   */
  verifyOtp({ otp }) {
    return backendJson("/admin/invite/verify-otp", {
      method: "POST",
      json: { otp: String(otp || "").trim() },
      suppressGlobalServerErrorToast: true,
    });
  },

  /**
   * POST /admin/invite
   * @param {{ fullName: string, email: string, role: "ADMIN"|"OWNER", inviteActionToken: string }} body
   */
  createInvite(body) {
    return backendJson("/admin/invite", {
      method: "POST",
      json: body,
      suppressGlobalServerErrorToast: true,
    });
  },

  /** GET /admin/invite/:token — public; validate invite before password setup. */
  getInvite(token) {
    const enc = encodeURIComponent(String(token || "").trim());
    return backendJson(`/admin/invite/${enc}`, {
      method: "GET",
      suppressGlobalServerErrorToast: true,
    });
  },

  /**
   * POST /admin/invite/complete — public; set password and activate admin account.
   * @param {{ token: string, password: string }} body
   */
  completeInvite(body) {
    return backendJson("/admin/invite/complete", {
      method: "POST",
      json: body,
      suppressGlobalServerErrorToast: true,
    });
  },
};
