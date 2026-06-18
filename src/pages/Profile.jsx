import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeProfilePayload, useAuth } from "../context/AuthContext";
import { kycBackend, profileBackend } from "../services/backendApis";
import {
  extractProfilePhotoFromPayload,
  resolveProfilePhotoUrl,
} from "../utils/mediaUrl";
import { invalidateDashboardData } from "../services/dashboardInvalidate";
import { showError, showSuccess } from "../services/toast";
import { maskDocumentNumber, safeUpper } from "../utils/mask";
import { canonicalizeKycStatus, KYC_CANONICAL, kycCanonicalLabel, normalizeUserKycMePayload, pickProfileKycRejectionReason } from "../utils/kycAdmin";
import {
  buildKycUploadFormData,
  formatKycUploadApiError,
  KycUploadValidationError,
  normalizeKycDocumentType,
} from "../utils/kycUpload";
import { maskKycStoredLabel } from "../utils/kycDocumentAccess";
import { pickPrimaryKycDocumentStoredUrl } from "../utils/kycDocumentCandidates";
import KycDocumentLink from "../components/KycDocumentLink";
import KycDocumentPreview from "../components/KycDocumentPreview";
import { buildReferralRegistrationLink } from "../utils/referralStorage";
import "./Profile.css";

const KYC_POLL_MS = 60_000;

const EMAIL_UPDATE_NOTICE =
  "Email updates are managed by administrators. Please contact support.";

function validateKycReuploadFields(documentType, documentNumber) {
  const type = normalizeKycDocumentType(documentType);
  const number = String(documentNumber || "").trim();
  if (!type) return "Select a document type.";
  if (!["AADHAAR", "PAN", "DRIVING_LICENSE"].includes(type)) {
    return "Unsupported document type.";
  }
  if (!number) return "Enter the document number.";
  if (type === "AADHAAR" && !/^\d{12}$/.test(number)) {
    return "Aadhaar must be 12 digits.";
  }
  if (type === "PAN" && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(number)) {
    return "Invalid PAN format (ABCDE1234F).";
  }
  if (type === "DRIVING_LICENSE" && !/^[A-Z0-9]{5,20}$/i.test(number)) {
    return "Enter a valid driving license number.";
  }
  return "";
}

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kyc, setKyc] = useState(null);
  const [kycError, setKycError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: "", phoneNumber: "" });
  const [draftErrors, setDraftErrors] = useState({});
  const fileRef = useRef(null);
  const kycFileRef = useRef(null);
  const kycPollTickInFlightRef = useRef(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [kycUploading, setKycUploading] = useState(false);
  const [kycResubmitting, setKycResubmitting] = useState(false);
  const [kycPendingFile, setKycPendingFile] = useState(null);
  const [kycReuploadDocType, setKycReuploadDocType] = useState("");
  const [kycReuploadDocNumber, setKycReuploadDocNumber] = useState("");

  const [kycDocType, setKycDocType] = useState("");
  const [kycDocNumber, setKycDocNumber] = useState("");
  const [contactEmailNoticeOpen, setContactEmailNoticeOpen] = useState(false);
  const navigate = useNavigate();
  const { token: authToken, hydrateProfile, logout } = useAuth();

  const handlePhoneChangeClick = () => {
    setEditMode(true);
    showSuccess("To change your phone number, use Edit Profile.");
  };

  useEffect(() => {
    if (!authToken) {
      navigate("/login", {
        replace: true,
        state: { message: "Please login to continue" },
      });
      return;
    }
    void fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    setError("");
    try {
      if (!authToken) {
        navigate("/login", {
          replace: true,
          state: { message: "Please login to continue" },
        });
        return;
      }

      const data = await profileBackend.getProfile();
      const normalized = normalizeProfilePayload(data || null);
      setProfile(normalized || null);
      void hydrateProfile();
      setDraft({
        name: String(normalized?.name || ""),
        phoneNumber: String(normalized?.phoneNumber || ""),
      });
      setDraftErrors({});
      setEditMode(false);

      setKycError("");
      try {
        const kycRes = await kycBackend.me();
        setKyc(normalizeUserKycMePayload(kycRes) || kycRes || null);
      } catch (e) {
        setKyc(null);
        setKycError(e?.message || "Unable to load KYC details.");
      }
    } catch (err) {
      const message =
        err?.message ||
        (typeof err === "string" ? err : "") ||
        "Failed to load profile. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Lightweight KYC status refresh (visible-only) so admin verify/reject reflects on user side.
  useEffect(() => {
    if (!authToken) return undefined;
    let intervalId = null;
    let cancelled = false;
    const clear = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (kycPollTickInFlightRef.current) return;
      kycPollTickInFlightRef.current = true;
      try {
        const kycRes = await kycBackend.me();
        if (cancelled) return;
        setKyc(normalizeUserKycMePayload(kycRes) || kycRes || null);
        setKycError("");
      } catch (e) {
        if (cancelled) return;
        // Keep current UI; only surface if we never loaded KYC before.
        setKycError((prev) => prev || (e?.message || "Unable to load KYC details."));
      } finally {
        kycPollTickInFlightRef.current = false;
      }
    };
    const start = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(() => void tick(), KYC_POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") clear();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [authToken]);

  const photoUrl = useMemo(() => {
    const raw =
      extractProfilePhotoFromPayload(profile) ||
      [
        profile?.profilePhotoUrl,
        profile?.avatarUrl,
        profile?.photoUrl,
        profile?.photoPath,
        profile?.photo,
      ]
        .map((v) => String(v ?? "").trim())
        .find((v) => v && v !== "null") ||
      "";
    if (!raw) return "";
    const resolved = resolveProfilePhotoUrl(raw);
    if (!resolved) return "";
    return `${resolved}${resolved.includes("?") ? "&" : "?"}t=${photoVersion || Date.now()}`;
  }, [profile, photoVersion]);

  const accountVerified = Boolean(
    profile?.accountVerified ||
      profile?.isAccountVerified ||
      profile?.emailVerified ||
      profile?.isEmailVerified ||
      profile?.verified === true,
  );

  const kycNested = profile?.kyc && typeof profile.kyc === "object" ? profile.kyc : null;
  const kycVerifiedFlag = Boolean(
    profile?.kycVerified ||
      profile?.isKycVerified ||
      kyc?.kycVerified ||
      kyc?.verified ||
      kycNested?.verified ||
      kycNested?.kycVerified,
  );
  const kycStatusRaw = safeUpper(
    profile?.kycStatus ||
      kyc?.status ||
      kycNested?.status ||
      profile?.kyc?.status ||
      (kycVerifiedFlag ? "VERIFIED" : ""),
  );
  const kycCanon = canonicalizeKycStatus(kycStatusRaw);
  const kycStatus = (() => {
    if (kycCanon === KYC_CANONICAL.VERIFIED) return "APPROVED";
    if (kycCanon === KYC_CANONICAL.REJECTED) return "REJECTED";
    if (kycCanon === KYC_CANONICAL.REUPLOAD_REQUIRED) return "REUPLOAD_REQUIRED";
    if (kycCanon === KYC_CANONICAL.UNDER_REVIEW) return "UNDER_REVIEW";
    if (kycStatusRaw === "PENDING") return "PENDING";
    return "PENDING";
  })();

  const kycUploadLocked =
    kycCanon === KYC_CANONICAL.VERIFIED ||
    kycCanon === KYC_CANONICAL.UNDER_REVIEW;

  const kycNeedsReupload =
    kycCanon === KYC_CANONICAL.REJECTED ||
    kycCanon === KYC_CANONICAL.REUPLOAD_REQUIRED;

  useEffect(() => {
    if (!kycNeedsReupload) return;
    const type = normalizeKycDocumentType(
      kyc?.documentType || profile?.documentType,
    );
    const number = String(
      kyc?.documentNumber || profile?.documentNumber || "",
    ).trim();
    setKycReuploadDocType((prev) => prev || type);
    setKycReuploadDocNumber((prev) => prev || number);
  }, [
    kycNeedsReupload,
    kyc?.documentType,
    kyc?.documentNumber,
    profile?.documentType,
    profile?.documentNumber,
  ]);

  useEffect(() => {
    setKycPendingFile(null);
    if (kycFileRef.current) kycFileRef.current.value = "";
  }, [kycNeedsReupload, kycCanon]);

  const kycBadge = (() => {
    const label = kycCanonicalLabel(kycCanon);
    if (kycCanon === KYC_CANONICAL.VERIFIED) return { label, tone: "success" };
    if (kycCanon === KYC_CANONICAL.REJECTED) return { label, tone: "danger" };
    if (kycCanon === KYC_CANONICAL.REUPLOAD_REQUIRED) return { label, tone: "warning" };
    if (kycCanon === KYC_CANONICAL.UNDER_REVIEW) return { label, tone: "neutral" };
    return { label, tone: "warning" };
  })();

  const accountBadge = accountVerified
    ? { label: "Account Verified", tone: "success" }
    : { label: "Account Unverified", tone: "neutral" };

  const referralCode = String(profile?.referralCode || "").trim();
  const referralLink = useMemo(
    () => buildReferralRegistrationLink(referralCode),
    [referralCode],
  );

  const copyReferralLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      showSuccess("Referral link copied");
    } catch {
      showError("Could not copy referral link");
    }
  };

  const shareReferralLink = async () => {
    if (!referralLink) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Join me",
          text: "Register using my referral link:",
          url: referralLink,
        });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await copyReferralLink();
  };

  const validateDraft = (nextDraft) => {
    const errs = {};
    const name = String(nextDraft?.name || "").trim();
    const phone = String(nextDraft?.phoneNumber || "").replace(/\s+/g, "");

    if (!name) errs.name = "Name is required.";

    const digits = phone.replace(/\D/g, "");
    if (!digits) errs.phoneNumber = "Phone number is required.";
    else if (digits.length !== 10) errs.phoneNumber = "Enter a 10-digit phone number.";

    return { errs, values: { name, phoneNumber: digits } };
  };

  const saveProfile = async () => {
    if (saving) return;
    const { errs, values } = validateDraft(draft);
    setDraftErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await profileBackend.updateProfile(values);
      showSuccess("Profile updated");
      setEditMode(false);
      await fetchProfile(); // refresh from GET (single source of truth)
      invalidateDashboardData("profile-update");
    } catch (e) {
      showError(e?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const onPickPhoto = (file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      showError("Please select an image file");
      return;
    }
    // Backend enforces a strict upload cap (observed: "Maximum upload size exceeded").
    // Keep this conservative to avoid server-side 500s.
    if (file.size > 1 * 1024 * 1024) {
      showError("Image is too large (max 1MB). Please compress and retry.");
      return;
    }
    const url = URL.createObjectURL(file);
    setPhotoFile(file);
    setPhotoPreview(url);
  };

  const cancelPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview("");
    setPhotoFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const clearKycPendingFile = () => {
    setKycPendingFile(null);
    if (kycFileRef.current) kycFileRef.current.value = "";
  };

  const openKycFilePicker = () => {
    kycFileRef.current?.click();
  };

  const onPickKycDocument = (file) => {
    if (!file) return;
    const name = String(file.name || "").toLowerCase();
    const isPdf =
      file.type === "application/pdf" || name.endsWith(".pdf");
    const isImage = String(file.type || "").startsWith("image/");
    if (!isPdf && !isImage) {
      showError("Please select an image or PDF document.");
      clearKycPendingFile();
      return;
    }
    setKycPendingFile(file);
  };

  const uploadKycDocument = async () => {
    const file = kycPendingFile;
    if (!file) {
      showError("Choose a document to upload.");
      return;
    }

    const documentType = kycNeedsReupload
      ? normalizeKycDocumentType(kycReuploadDocType)
      : normalizeKycDocumentType(kycDocType);
    const documentNumber = kycNeedsReupload
      ? String(kycReuploadDocNumber || "").trim()
      : String(kycDocNumber || "").trim();

    const validationError = validateKycReuploadFields(
      documentType,
      documentNumber,
    );
    if (validationError) {
      showError(validationError);
      return;
    }

    setKycUploading(true);
    try {
      const fd = buildKycUploadFormData({
        file,
        documentType,
        documentNumber,
      });

      if (kycNeedsReupload) {
        await kycBackend.reupload(fd);
        showSuccess("KYC documents re-uploaded for review");
      } else {
        await kycBackend.upload(fd);
        showSuccess("KYC document uploaded");
      }
      clearKycPendingFile();
      await fetchProfile();
      invalidateDashboardData(kycNeedsReupload ? "kyc-reupload" : "kyc-upload");
    } catch (e) {
      const fallback = kycNeedsReupload ? "KYC re-upload failed" : "KYC upload failed";
      showError(
        e instanceof KycUploadValidationError
          ? e.message
          : formatKycUploadApiError(e, fallback),
      );
    } finally {
      setKycUploading(false);
    }
  };

  const resubmitKyc = async () => {
    setKycResubmitting(true);
    try {
      await kycBackend.resubmit({});
      showSuccess("KYC resubmitted for review");
      await fetchProfile();
      invalidateDashboardData("kyc-resubmit");
    } catch (e) {
      showError(e?.message || "Could not resubmit KYC");
    } finally {
      setKycResubmitting(false);
    }
  };

  const uploadPhoto = async () => {
    if (!photoFile || photoUploading) return;
    setPhotoUploading(true);
    try {
      await profileBackend.uploadPhoto(photoFile);
      showSuccess("Profile photo updated");
      cancelPhoto();
      await fetchProfile();
      setPhotoVersion((v) => v + 1);
      invalidateDashboardData("profile-photo");
    } catch (e) {
      const status = Number(e?.status) || 0;
      if (status >= 500) {
        const backendMsg =
          (e?.payload && typeof e.payload === "object" && e.payload.message) ||
          e?.message ||
          "";
        showError(
          backendMsg
            ? `Upload failed (server error): ${backendMsg}`
            : "Upload failed due to a server error. Try a smaller JPG/PNG (≤ 6MB) and retry.",
        );
      } else {
        showError(e?.message || "Failed to upload photo");
      }
    } finally {
      setPhotoUploading(false);
    }
  };

  if (loading)
    return (
      <div className="pf-page">
        <div className="pf-shell">
          <div className="pf-hero pf-hero--skeleton">
            <div className="pf-sk-avatar" />
            <div className="pf-sk-lines">
              <div className="pf-sk-line pf-sk-line--h" />
              <div className="pf-sk-line" />
              <div className="pf-sk-line pf-sk-line--sm" />
            </div>
            <div className="pf-sk-actions">
              <div className="pf-sk-pill" />
              <div className="pf-sk-pill" />
              <div className="pf-sk-btn" />
            </div>
          </div>

          <div className="pf-columns">
            <div className="pf-col">
              <div className="pf-card pf-card--skeleton" />
              <div className="pf-card pf-card--skeleton" />
            </div>
            <div className="pf-col">
              <div className="pf-card pf-card--skeleton" />
              <div className="pf-card pf-card--skeleton" />
            </div>
          </div>
        </div>
      </div>
    );

  if (error) {
    return (
      <div className="pf-page">
        <div className="pf-shell">
          <div className="pf-error">
            <div className="pf-error-title">Couldn’t load your profile</div>
            <div className="pf-error-sub">{error}</div>
            <div className="pf-error-actions">
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => void fetchProfile()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="pf-page">
        <div className="pf-shell">
          <div className="pf-empty">
            <div className="pf-empty-title">No profile data found</div>
            <div className="pf-empty-sub">Try refreshing this page.</div>
            <div className="pf-empty-actions">
              <button type="button" className="pf-btn pf-btn--primary" onClick={() => void fetchProfile()}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const userId = String(
    profile?.userId ||
    profile?.id ||
    window.localStorage.getItem("userId") ||
    ""
  ).trim();
  
  const email = String(profile?.email || "").trim();
  const name = String(profile?.name || "User").trim();
  const phone = String(profile?.phoneNumber || "").trim();

  const docType = String(kyc?.documentType || profile?.documentType || "").trim();
  const docNumber = maskDocumentNumber(kyc?.documentNumber || profile?.documentNumber);
  const filePath = pickPrimaryKycDocumentStoredUrl({
    ...profile,
    ...kyc,
    kyc: profile?.kyc || kyc,
    _raw: kyc?._raw || profile?.kyc || kyc,
  });
  const filePathLabel = maskKycStoredLabel(filePath);
  const uploadedAt = kyc?.uploadedAt ? new Date(kyc.uploadedAt) : null;

  const kycDisplayRejectionReason = pickProfileKycRejectionReason(profile, kyc);

  return (
    <div className="pf-page">
      <div className="pf-shell">
        <div className="pf-hero">
          <div className="pf-hero-left">
            <div className="pf-avatar">
              {photoPreview ? (
                <img className="pf-avatar-img" src={photoPreview} alt="New profile preview" />
              ) : photoUrl ? (
                <img
                  className="pf-avatar-img"
                  src={photoUrl}
                  alt="Profile"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = "https://cdn-icons-png.flaticon.com/512/149/149071.png";
                  }}
                />
              ) : (
                <div className="pf-avatar-fallback">{(name || "U").charAt(0).toUpperCase()}</div>
              )}
            </div>

            <div className="pf-photo-actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="pf-file"
                onChange={(e) => onPickPhoto(e.target.files?.[0])}
              />
              <button
                type="button"
                className="pf-btn pf-btn--ghost"
                onClick={() => fileRef.current?.click()}
                disabled={photoUploading}
              >
                {photoUrl ? "Change photo" : "Upload photo"}
              </button>
              {photoPreview ? (
                <button
                  type="button"
                  className="pf-btn pf-btn--danger"
                  onClick={cancelPhoto}
                  disabled={photoUploading}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          <div className="pf-hero-center">
            <div className="pf-identity">
              <div className="pf-name">{name || "—"}</div>
              <div className="pf-email">{email || "—"}</div>
              <div className="pf-meta-row">
                <span className="pf-meta-icon" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M4 20a8 8 0 0 1 16 0"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div className="pf-meta-text">
                  <div className="pf-meta-k">User ID</div>
                  <div className="pf-meta-v pf-mono">{userId || "—"}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="pf-hero-right">
            <div className="pf-hero-actions">
              {!editMode ? (
                <button type="button" className="pf-btn pf-btn--ghost" onClick={() => setEditMode(true)}>
                  Edit Profile
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="pf-btn pf-btn--ghost"
                    onClick={() => {
                      setEditMode(false);
                      setDraft({
                        name: String(profile?.name || ""),
                        phoneNumber: String(profile?.phoneNumber || ""),
                      });
                      setDraftErrors({});
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="pf-btn pf-btn--primary"
                    onClick={() => void saveProfile()}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {photoPreview ? (
          <div className="pf-upload-bar">
            <div className="pf-upload-left">
              <img className="pf-upload-thumb" src={photoPreview} alt="Selected preview" />
              <div>
                <div className="pf-upload-title">Preview ready</div>
                <div className="pf-upload-sub">Upload to apply your new profile photo.</div>
              </div>
            </div>
            <button
              type="button"
              className="pf-btn pf-btn--primary"
              onClick={() => void uploadPhoto()}
              disabled={photoUploading}
            >
              {photoUploading ? "Uploading..." : "Upload photo"}
            </button>
          </div>
        ) : null}

        <div className="pf-columns">
          <div className="pf-col">
            <section className="pf-card pf-card--personal">
              <header className="pf-card-head">
                <div>
                  <div className="pf-card-title">Personal Information</div>
                  <div className="pf-card-sub">Your primary account details.</div>
                </div>
              </header>
              <div className="pf-card-body">
                <div className="pf-fields">
                  <div className="pf-field">
                    <div className="pf-label">Name</div>
                    {!editMode ? (
                      <div className="pf-value">{name || "—"}</div>
                    ) : (
                      <>
                        <input
                          className={`pf-input ${draftErrors.name ? "pf-input--error" : ""}`}
                          type="text"
                          value={draft.name}
                          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                          onBlur={() =>
                            setDraftErrors((prev) => ({
                              ...prev,
                              ...(validateDraft(draft).errs || {}),
                            }))
                          }
                          placeholder="Enter your name"
                          disabled={saving}
                        />
                        {draftErrors.name ? <div className="pf-error-text">{draftErrors.name}</div> : null}
                      </>
                    )}
                  </div>

                  <div className="pf-field">
                    <div className="pf-label-row">
                      <div className="pf-label">Email</div>
                      <button
                        type="button"
                        className="pf-btn pf-btn--ghost pf-btn--sm"
                        onClick={() => setContactEmailNoticeOpen(true)}
                      >
                        Change
                      </button>
                    </div>
                    <div className="pf-value">{email || "—"}</div>
                  </div>

                  <div className="pf-field">
                    <div className="pf-label-row">
                      <div className="pf-label">Phone</div>
                      {!editMode ? (
                        <button
                          type="button"
                          className="pf-btn pf-btn--ghost pf-btn--sm"
                          onClick={handlePhoneChangeClick}
                        >
                          Change
                        </button>
                      ) : null}
                    </div>
                    {!editMode ? (
                      <div className="pf-value">{phone || "—"}</div>
                    ) : (
                      <>
                        <input
                          className={`pf-input ${draftErrors.phoneNumber ? "pf-input--error" : ""}`}
                          type="tel"
                          inputMode="numeric"
                          value={draft.phoneNumber}
                          onChange={(e) => setDraft((p) => ({ ...p, phoneNumber: e.target.value }))}
                          onBlur={() =>
                            setDraftErrors((prev) => ({
                              ...prev,
                              ...(validateDraft(draft).errs || {}),
                            }))
                          }
                          placeholder="10-digit phone number"
                          disabled={saving}
                        />
                        {draftErrors.phoneNumber ? (
                          <div className="pf-error-text">{draftErrors.phoneNumber}</div>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="pf-field">
                    <div className="pf-label">User ID</div>
                    <div className="pf-value pf-mono">{userId || "—"}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="pf-card pf-card--kyc">
              <header className="pf-card-head">
                <div>
                  <div className="pf-card-title">KYC Documents</div>
                  <div className="pf-card-sub">Your submitted documents and review timeline.</div>
                </div>
              </header>
              <div className="pf-card-body">
                {kycError ? <div className="pf-inline-error">{kycError}</div> : null}

                {kycNeedsReupload ? (
                  <div
                    style={{
                      marginBottom: 12,
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(245,158,11,0.35)",
                      background: "rgba(245,158,11,0.08)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 8,
                      }}
                    >
                      <strong>
                        {kycStatus === "REUPLOAD_REQUIRED"
                          ? "Re-upload required"
                          : "Previous submission was rejected"}
                      </strong>
                      <span className={`pf-badge pf-badge--${kycBadge.tone}`}>
                        {kycBadge.label}
                      </span>
                    </div>
                    <p className="pf-muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
                      Upload new documents below, then submit for review. Your previous
                      submission is no longer active.
                    </p>
                    {kycDisplayRejectionReason ? (
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                        {kycStatus === "REUPLOAD_REQUIRED" ? "Instructions: " : "Reason: "}
                        {kycDisplayRejectionReason}
                      </p>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13 }}>
                        Please upload clearer documents and resubmit for review.
                      </p>
                    )}
                  </div>
                ) : null}



                <div className="pf-fields" style={{ marginBottom: 14 }}>
                  <div className="pf-field pf-field--span">
                    <div className="pf-label">
                      {kycNeedsReupload ? "Upload new documents" : "Upload KYC document"}
                    </div>
                    {kycUploadLocked ? (
                      <p className="pf-muted" style={{ margin: "8px 0 0" }}>
                        {kycCanon === KYC_CANONICAL.VERIFIED
                          ? "Your identity is verified. Document uploads are disabled."
                          : "Your documents are under review. Uploads are temporarily disabled."}
                      </p>
                    ) : (
                      <>
                        {kycNeedsReupload ? (
                          <div
                            className="pf-fields pf-fields--2"
                            style={{ marginBottom: 12 }}
                          >
                            <div className="pf-field">
                              <div className="pf-label">Document type</div>
                              <select
                                className="pf-input"
                                value={kycReuploadDocType}
                                onChange={(e) =>
                                  setKycReuploadDocType(e.target.value)
                                }
                                disabled={kycUploading}
                              >
                                <option value="">Select document type</option>
                                <option value="AADHAAR">Aadhaar</option>
                                <option value="PAN">PAN</option>
                                <option value="DRIVING_LICENSE">
                                  Driving license
                                </option>
                              </select>
                            </div>
                            <div className="pf-field">
                              <div className="pf-label">Document number</div>
                              <input
                                className="pf-input"
                                type="text"
                                value={kycReuploadDocNumber}
                                onChange={(e) =>
                                  setKycReuploadDocNumber(e.target.value)
                                }
                                disabled={kycUploading}
                                placeholder={
                                  kycReuploadDocType === "AADHAAR"
                                    ? "12-digit Aadhaar"
                                    : kycReuploadDocType === "PAN"
                                      ? "ABCDE1234F"
                                      : "License number"
                                }
                              />
                            </div>
                          </div>
                        ) : null}

{!kycNeedsReupload ? (
  <div
    className="pf-fields pf-fields--2"
    style={{ marginBottom: 12 }}
  >
    <div className="pf-field">

      <div className="pf-label">
        Document type
      </div>

      <select
        className="pf-input"
        value={kycDocType}
        onChange={(e) =>
          setKycDocType(e.target.value)
        }
      >
        <option value="">
          Select document type
        </option>

        <option value="AADHAAR">
          Aadhaar
        </option>

        <option value="PAN">
          PAN
        </option>

        <option value="DRIVING_LICENSE">
          Driving License
        </option>

      </select>

    </div>

    <div className="pf-field">

      <div className="pf-label">
        Document number
      </div>

      <input
        className="pf-input"
        type="text"
        value={kycDocNumber}
        onChange={(e) =>
          setKycDocNumber(e.target.value)
        }
        placeholder="Document Number"
      />

    </div>

  </div>
) : null}

                        <input
                          ref={kycFileRef}
                          type="file"
                          className="pf-file"
                          accept="image/*,.pdf,application/pdf"
                          disabled={kycUploading}
                          onChange={(e) => onPickKycDocument(e.target.files?.[0])}
                        />
                        {kycPendingFile ? (
                          <div
                            className="pf-inline"
                            style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}
                          >
                            <span className="pf-value pf-mono">{kycPendingFile.name}</span>
                            <button
                              type="button"
                              className="pf-btn pf-btn--ghost pf-btn--sm"
                              onClick={clearKycPendingFile}
                              disabled={kycUploading}
                            >
                              Remove
                            </button>
                          </div>
                        ) : null}
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="pf-btn pf-btn--ghost"
                            onClick={openKycFilePicker}
                            disabled={kycUploading}
                          >
                            {kycNeedsReupload
                              ? "Upload new documents"
                              : "Choose document"}
                          </button>
                          <button
                            type="button"
                            className="pf-btn pf-btn--primary"
                            onClick={() => void uploadKycDocument()}
                            disabled={kycUploading || !kycPendingFile}
                          >
                            {kycUploading
                              ? "Uploading…"
                              : kycNeedsReupload
                                ? "Re-upload for review"
                                : "Upload to KYC"}
                          </button>
                          {!kycNeedsReupload &&
                          (kycStatus === "REJECTED" ||
                            kycStatus === "PENDING" ||
                            kycStatus === "REUPLOAD_REQUIRED") ? (
                            <button
                              type="button"
                              className="pf-btn pf-btn--ghost"
                              onClick={() => void resubmitKyc()}
                              disabled={kycResubmitting}
                            >
                              {kycResubmitting ? "Submitting…" : "Resubmit for review"}
                            </button>
                          ) : null}
                        </div>
                        {kycNeedsReupload ? (
                          <p className="pf-muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
                            Choose a file, confirm document type and number, then click
                            re-upload for review.
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                {!kyc && !kycError ? (
                  <div className="pf-empty-mini">
                    <div className="pf-empty-mini-title">No KYC record found</div>
                    <div className="pf-empty-mini-sub">Submit documents to start verification.</div>
                  </div>
                ) : null}

                {kyc ? (
                  <>
                    <div className="pf-fields pf-fields--2">
                      {kycNeedsReupload && filePath ? (
                        <div className="pf-field pf-field--span">
                          <div className="pf-label">Previous submission (rejected)</div>
                          <div
                            className="pf-value pf-mono"
                            style={{ opacity: 0.75, textDecoration: "line-through" }}
                          >
                            {filePathLabel}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="pf-field">
                            <div className="pf-label">Uploaded Document</div>
                            {filePath ? (
                              <KycDocumentPreview storedUrl={filePath} />
                            ) : (
                              <div className="pf-value">—</div>
                            )}
                          </div>
                          <div className="pf-field">
                            <div className="pf-label">File</div>
                            <div className="pf-value pf-mono">{filePathLabel}</div>
                          </div>
                          <div className="pf-field">
                            <div className="pf-label">Uploaded</div>
                            <div className="pf-value">
                              {uploadedAt ? uploadedAt.toLocaleString() : "—"}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="pf-timeline">
                      <div className="pf-step pf-step--done">
                        <div className="pf-step-dot" />
                        <div className="pf-step-text">
                          <div className="pf-step-title">Submitted</div>
                          <div className="pf-step-sub">Documents uploaded successfully.</div>
                        </div>
                      </div>

                      <div
                        className={`pf-step ${
                          kycStatus === "PENDING" ||
                          kycStatus === "UNDER_REVIEW" ||
                          kycStatus === "APPROVED" ||
                          kycStatus === "REJECTED" ||
                          kycStatus === "REUPLOAD_REQUIRED"
                            ? "pf-step--done"
                            : ""
                        }`}
                      >
                        <div className="pf-step-dot" />
                        <div className="pf-step-text">
                          <div className="pf-step-title">Under Review</div>
                          <div className="pf-step-sub">Admin is reviewing your submission.</div>
                        </div>
                      </div>

                      <div
                        className={`pf-step ${
                          kycStatus === "APPROVED"
                            ? "pf-step--done pf-step--success"
                            : kycStatus === "REJECTED"
                              ? "pf-step--done pf-step--danger"
                              : kycStatus === "REUPLOAD_REQUIRED"
                                ? "pf-step--done pf-step--danger"
                                : ""
                        }`}
                      >
                        <div className="pf-step-dot" />
                        <div className="pf-step-text">
                          <div className="pf-step-title">
                            {kycStatus === "REJECTED"
                              ? "Rejected"
                              : kycStatus === "REUPLOAD_REQUIRED"
                                ? "Re-upload required"
                                : kycStatus === "APPROVED"
                                  ? "Approved"
                                  : "Decision"}
                          </div>
                          <div className="pf-step-sub">
                            {kycStatus === "REJECTED"
                              ? "Your KYC was rejected. Please re-submit."
                              : kycStatus === "REUPLOAD_REQUIRED"
                                ? "Please upload clearer documents as requested."
                                : kycStatus === "APPROVED"
                                  ? "Your KYC is approved."
                                  : "Awaiting a decision on your submission."}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pf-actions">
                      {filePath && !kycNeedsReupload ? (
                        <KycDocumentLink
                          storedUrl={filePath}
                          className="pf-btn pf-btn--ghost"
                        />
                      ) : null}
                      {safeUpper(kyc?.status) === "PENDING" || kycStatus === "UNDER_REVIEW" ? (
                        <button
                          type="button"
                          className="pf-btn pf-btn--primary"
                          onClick={() => showSuccess("KYC is pending review")}
                        >
                          {kycStatus === "UNDER_REVIEW" ? "Under review" : "KYC Pending"}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          </div>

          <div className="pf-col">
            <section className="pf-card pf-card--verify">
              <header className="pf-card-head">
                <div>
                  <div className="pf-card-title">Verification Center</div>
                  <div className="pf-card-sub">Account verification and KYC approval status.</div>
                </div>
              </header>
              <div className="pf-card-body">
                <div className="pf-verify">
                  <div className="pf-verify-row">
                    <div className="pf-verify-left">
                      <div className="pf-verify-title">Account Verification</div>
                      <div className="pf-verify-sub">Email/phone verification status.</div>
                    </div>
                    <span className={`pf-badge pf-badge--${accountBadge.tone}`}>{accountBadge.label}</span>
                  </div>

                  <div className="pf-divider" />

                  <div className="pf-verify-row">
                    <div className="pf-verify-left">
                      <div className="pf-verify-title">KYC Verification</div>
                      <div className="pf-verify-sub">Admin-approved document verification.</div>
                    </div>
                    <span className={`pf-badge pf-badge--${kycBadge.tone}`}>{kycBadge.label}</span>
                  </div>

                  <div className="pf-divider" />

                  <div className="pf-fields pf-fields--2">
                    <div className="pf-field">
                      <div className="pf-label">Document Type</div>
                      <div className="pf-value">{docType || "—"}</div>
                    </div>
                    <div className="pf-field">
                      <div className="pf-label">Document Number</div>
                      <div className="pf-value pf-mono">{docNumber || "—"}</div>
                    </div>
                    <div className="pf-field pf-field--span">
                      <div className="pf-label">Invite friends</div>
                      {referralLink ? (
                        <>
                          <div className="pf-value pf-mono" style={{ wordBreak: "break-all" }}>
                            {referralLink}
                          </div>
                          <div className="pf-inline" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="pf-btn pf-btn--ghost pf-btn--sm"
                              onClick={() => void copyReferralLink()}
                            >
                              Copy link
                            </button>
                            <button
                              type="button"
                              className="pf-btn pf-btn--ghost pf-btn--sm"
                              onClick={() => void shareReferralLink()}
                            >
                              Share
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="pf-value">—</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="pf-card pf-card--actions">
            <header className="pf-card-head">
              <div>
                <div className="pf-card-title">Account Actions</div>
                <div className="pf-card-sub">Quick actions for your account.</div>
              </div>
            </header>
            <div className="pf-card-body">
              <div className="pf-actions pf-actions--stack">
                <button type="button" className="pf-btn pf-btn--ghost" onClick={() => setEditMode(true)}>
                  Edit profile
                </button>
                <button type="button" className="pf-btn pf-btn--ghost" onClick={() => navigate("/settings")}>
                  Go to settings
                </button>
                <button
                  type="button"
                  className="pf-btn pf-btn--danger"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
          </section>
          </div>
        </div>

        <ContactEmailNoticeModal
          open={contactEmailNoticeOpen}
          message={EMAIL_UPDATE_NOTICE}
          onClose={() => setContactEmailNoticeOpen(false)}
        />
      </div>
    </div>
  );
}

function ContactEmailNoticeModal({ open, message, onClose }) {
  if (!open) return null;

  return (
    <div
      className="pf-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Email update"
    >
      <div className="pf-modal">
        <div className="pf-modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="pf-modal-title">Email update</div>
            <div className="pf-modal-subtitle">Self-service email change is not available.</div>
          </div>
          <button
            type="button"
            className="pf-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="pf-modal-body">
          <p className="pf-value" style={{ margin: 0, lineHeight: 1.5 }}>
            {message}
          </p>
          <div className="pf-modal-actions">
            <button type="button" className="pf-btn pf-btn--primary" onClick={onClose}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
