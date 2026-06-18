import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import Logo from "../components/Logo";
import { showSuccess, showError } from "../services/toast";
import "./Registration.css";
import { buildApiRequestUrl } from "../services/apiConfig";
import {
  clearStoredReferralRef,
  resolveReferralCodeForSubmit,
  resolveReferralInviteState,
} from "../utils/referralStorage";
import ReferralCodeField from "../components/ReferralCodeField";

/** Same origin + path as `apiFetch("/register")` → `buildApiRequestUrl("/register")`; kept explicit for registration-only fetch. */
const REGISTER_URL = buildApiRequestUrl("/register");

const INDIVIDUAL_FIELDS = [
  { name: "fullName", placeholder: "Full Name", col: "left" },
  { name: "email", placeholder: "Email Address", col: "right" },
  { name: "password", placeholder: "Password", col: "left" },
  { name: "phone", placeholder: "Phone Number", col: "right" },
  { name: "address", placeholder: "Address", col: "left" },
  { name: "referral", placeholder: "Referral Code / Name", col: "right" },
];

const ORG_FIELDS = [
  { name: "orgName", placeholder: "Organization Name", col: "left" },
  { name: "email", placeholder: "Email Address", col: "right" },
  { name: "password", placeholder: "Password", col: "left" },
  { name: "phone", placeholder: "Phone Number", col: "right" },
  { name: "address", placeholder: "Address", col: "left" },
  { name: "referral", placeholder: "Referral Code / Name", col: "right" },
];

const REG_TYPES = {
  individual: {
    label: "Individual Registration",
    title: "Individual Registration Page",
    fields: INDIVIDUAL_FIELDS,
    kycHint: "Aadhaar Card, PAN Card",
    icon: "👤",
    sections: [
      {
        title: "Personal Info",
        subtitle: "Your identity basics.",
        fields: ["fullName", "email", "phone"],
      },
      {
        title: "Account Setup",
        subtitle: "Create your credentials.",
        fields: ["password", "address", "referral"],
      },
    ],
    requiredFields: ["fullName", "email", "password", "phone", "address"],
  },
  organization: {
    label: "Organization Registration",
    title: "Organization Registration Page",
    fields: ORG_FIELDS,
    kycHint: "Aadhaar Card, PAN Card",
    icon: "💼",
    sections: [
      {
        title: "Organization Info",
        subtitle: "Company identity.",
        fields: ["orgName", "email", "phone"],
      },
      {
        title: "Account Setup",
        subtitle: "Create your credentials.",
        fields: ["password", "address", "referral"],
      },
    ],
    requiredFields: ["orgName", "email", "password", "phone", "address"],
  },
};

function getInitialTypeFromPath(pathname) {
  return pathname.includes("/register/organization")
    ? "organization"
    : "individual";
}

function validateEmail(value) {
  const v = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function validatePhone(value) {
  const digits = normalizePhone(value);
  return digits.length >= 10 && digits.length <= 15;
}

function validatePassword(value) {
  return String(value || "").trim().length >= 6;
}

const ALLOWED_DOCUMENT_TYPES = ["PAN", "AADHAAR"];

function normalizeDocumentType(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  if (!raw) return "";
  if (raw === "AADHAR") return "AADHAAR";
  if (raw === "VOTER ID") return "VOTER_ID";
  return raw;
}

function getSelectedDocument(formData) {
  if (formData?.selectedFile) return formData.selectedFile;
  if (formData?.documentFile) return formData.documentFile;
  if (formData?.file) return formData.file;
  if (Array.isArray(formData?.documents) && formData.documents[0]) {
    return formData.documents[0];
  }
  return null;
}

function isFileLike(value) {
  const isFile = typeof File !== "undefined" && value instanceof File;
  const isBlob = typeof Blob !== "undefined" && value instanceof Blob;
  return isFile || isBlob;
}

function getFieldMeta(config, fieldName) {
  return config.fields.find((f) => f.name === fieldName) || null;
}

function getFieldLabel(fieldName) {
  const map = {
    fullName: "Full Name",
    email: "Email Address",
    password: "Password",
    phone: "Phone Number",
    address: "Address",
    referral: "Referral Code / Name",
    orgName: "Organization Name",
  };
  return map[fieldName] || fieldName;
}

function getFieldIcon(fieldName) {
  const map = {
    fullName: "👤",
    email: "✉️",
    password: "🔒",
    phone: "☎️",
    address: "🏠",
    referral: "🎟️",
    orgName: "🏢",
  };
  return map[fieldName] || "•";
}

export default function Registration() {
  const navigate = useNavigate();
  const location = useLocation();
  const initial = useMemo(
    () => getInitialTypeFromPath(location.pathname),
    [location.pathname],
  );
  const [type, setType] = useState(initial);
  const [formData, setFormData] = useState({});
  const [documentType, setDocumentType] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [touched, setTouched] = useState({});
  const [referralLocked, setReferralLocked] = useState(false);

  const config = REG_TYPES[type] ?? REG_TYPES.individual;

  // Auto-fill referral from ?ref= and persist for refresh / login → register return.
  useEffect(() => {
    const { ref, locked } = resolveReferralInviteState(location.search);
    setReferralLocked(locked);
    if (!ref) return;
    setFormData((prev) =>
      prev.referral && String(prev.referral).trim()
        ? prev
        : { ...prev, referral: ref },
    );
  }, [location.search]);

  useEffect(() => {
    setDocumentType(
      (prev) =>
        prev ||
        formData.documentType ||
        formData.docType ||
        formData.idType ||
        "",
    );
    setDocumentNumber(
      (prev) =>
        prev ||
        formData.documentNumber ||
        formData.idNumber ||
        formData.documentNo ||
        "",
    );
    setSelectedFile(
      (prev) =>
        prev ||
        formData.selectedFile ||
        formData.documentFile ||
        formData.file ||
        (Array.isArray(formData.documents)
          ? formData.documents[0] || null
          : null),
    );
  }, [formData]);

  const onTypeChange = (nextType) => {
    const normalized =
      nextType === "organization" ? "organization" : "individual";
    setType(normalized);
    const { ref: storedRef, locked } = resolveReferralInviteState(location.search);
    setReferralLocked(locked);
    setFormData(storedRef ? { referral: storedRef } : {});
    setDocumentType("");
    setDocumentNumber("");
    setSelectedFile(null);
    setTouched({});
    setSubmitError("");
    setSubmitSuccess("");
    navigate(
      normalized === "organization" ? "/register/organization" : "/register",
      { replace: true },
    );
  };

  const draftErrors = useMemo(() => {
    const errors = {};
    const required = config.requiredFields;
    required.forEach((name) => {
      const value = formData[name];
      if (!String(value || "").trim()) {
        errors[name] = `${getFieldLabel(name)} is required.`;
        return;
      }
      if (name === "email" && !validateEmail(value)) {
        errors[name] = "Enter a valid email address.";
      } else if (name === "phone" && !validatePhone(value)) {
        errors[name] = "Enter a valid phone number.";
      } else if (name === "password" && !validatePassword(value)) {
        errors[name] = "Password must be at least 6 characters.";
      }
    });

    return errors;
  }, [config.requiredFields, formData]);

  const canSubmit =
    !submitting && termsAccepted && Object.keys(draftErrors).length === 0;

  const handleSave = async () => {
    setSubmitError("");
    setSubmitSuccess("");

    setTouched((prev) => {
      const all = {};
      config.requiredFields.forEach((f) => {
        all[f] = true;
      });
      return { ...prev, ...all };
    });

    if (!canSubmit) {
      setSubmitError("Please fix the highlighted fields and try again.");
      return;
    }

    if (!selectedFile) {
      setSubmitError("Please upload document");
      return;
    }

    if (!documentType) {
      setSubmitError("Please select document type");
      return;
    }

    if (!documentNumber) {
      setSubmitError("Please enter document number");
      return;
    }

    if (documentType === "AADHAAR" && !/^\d{12}$/.test(documentNumber)) {
      setSubmitError("Aadhaar must be 12 digits");
      return;
    }

    if (
      documentType === "PAN" &&
      !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(documentNumber)
    ) {
      setSubmitError("Invalid PAN format (ABCDE1234F)");
      return;
    }

    const entityType = type === "organization" ? "ADMIN" : "INDIVIDUAL";

    const mappedName =
      type === "organization" ? formData.orgName : formData.fullName;

    if (!mappedName || !mappedName.trim()) {
      setSubmitError("Name is required");
      return;
    }

    setSubmitting(true);

    try {
      const payload = new FormData();

      payload.append("file", selectedFile);
      payload.append("documentType", documentType);
      payload.append("documentNumber", documentNumber);
      payload.append("entityType", entityType);
      payload.append("name", mappedName.trim());
      payload.append("email", formData.email);
      payload.append("phoneNumber", formData.phone);
      payload.append("password", formData.password);
      payload.append("address", formData.address);

      const referralCode = resolveReferralCodeForSubmit(formData.referral);
      if (referralCode) {
        payload.append("referralCode", referralCode);
      }

      if (import.meta.env.DEV) {
        for (const pair of payload.entries()) {
          // eslint-disable-next-line no-console
          console.log(pair[0], pair[1]);
        }
      }

      const response = await fetch(REGISTER_URL, {
        method: "POST",
        body: payload,
        credentials: "include",
      });

      const text = await response.text();
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("BACKEND RESPONSE:", text);
      }

      let result;
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = text;
      }

      if (!response.ok) {
        throw new Error(
          typeof result === "string"
            ? result
            : result?.message || result?.error || "Registration failed",
        );
      }

      showSuccess("Registration successful");
      clearStoredReferralRef();

      const serverHint =
        result && typeof result === "object" && !Array.isArray(result)
          ? String(result.message || result.data?.message || "").trim()
          : "";
      const flowReminder =
        "Next: verify your email using the link we sent → sign in → enter the OTP from email → dashboard.";
      const successDetail = serverHint ? `${serverHint} ${flowReminder}` : flowReminder;
      setSubmitSuccess(successDetail);

      setFormData({});
      setDocumentType("");
      setDocumentNumber("");
      setSelectedFile(null);
      setTouched({});

      setTimeout(
        () =>
          navigate("/login", {
            state: { message: successDetail },
          }),
        3000,
      );
    } catch (e) {
      const msg = e?.message || "Registration failed";
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error("FINAL ERROR:", msg);
      }
      showError(msg);
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="registration-page">
      {/* Left Branding Panel */}
      <aside className="reg-left-panel">
        <div className="reg-left-top">
          <Logo to="/" showText />
        </div>
        <div className="reg-left-middle">
          <h1 className="reg-left-title">{config.title}</h1>
          <p className="reg-left-desc">
            Create your account and unlock premium features.
          </p>
        </div>
        <div className="reg-left-bottom">
          <p className="reg-left-login">
            Already have an account?{" "}
            <Link to="/login" className="reg-left-link">
              Sign In
            </Link>
          </p>
        </div>
      </aside>

      {/* Right Form Panel */}
      <main className="reg-right-panel">
        <div className="reg-right-header">
          <h2 className="reg-right-title">Create your account</h2>
          <p className="reg-right-sub">Fill in your details to get started.</p>
        </div>

        <div className="reg-step-content">
          <div className="reg-switch">
            <label className="reg-switch-label" htmlFor="regType">
              Registration Type
            </label>
            <div className="reg-switch-control">
              <span className="reg-switch-icon" aria-hidden="true">
                {config.icon}
              </span>
              <select
                id="regType"
                className="reg-switch-select"
                value={type}
                onChange={(e) => onTypeChange(e.target.value)}
              >
                <option value="individual">Individual</option>
                <option value="organization">Organization</option>
              </select>
            </div>
          </div>

          {config.sections.map((section) => (
            <div key={section.title} className="reg-section-compact">
              <h4 className="reg-section-label">{section.title}</h4>
              <div className="reg-section-grid">
                {section.fields.map((fieldName) => {
                  const meta = getFieldMeta(config, fieldName);
                  const value = formData[fieldName] || "";
                  const error = touched[fieldName]
                    ? draftErrors[fieldName]
                    : "";
                  const hasError = !!error;

                  if (fieldName === "referral") {
                    return (
                      <ReferralCodeField
                        key={fieldName}
                        id="registration-referral"
                        value={value}
                        locked={referralLocked}
                        placeholder={
                          meta?.placeholder || getFieldLabel(fieldName)
                        }
                        error={hasError ? error : ""}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            [fieldName]: e.target.value,
                          }))
                        }
                        onBlur={() =>
                          setTouched((prev) => ({
                            ...prev,
                            [fieldName]: true,
                          }))
                        }
                      />
                    );
                  }

                  return (
                    <div key={fieldName} className="reg-input-block">
                      <label className="reg-label">
                        {getFieldLabel(fieldName)}
                      </label>
                      <div
                        className={`reg-input-with-icon ${hasError ? "reg-input-invalid" : ""}`}
                      >
                        <span className="reg-input-icon" aria-hidden>
                          {getFieldIcon(fieldName)}
                        </span>
                        <input
                          type={
                            fieldName.toLowerCase().includes("password")
                              ? "password"
                              : "text"
                          }
                          className="input reg-premium-input"
                          placeholder={
                            meta?.placeholder || getFieldLabel(fieldName)
                          }
                          value={value}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              [fieldName]: e.target.value,
                            }))
                          }
                          onBlur={() =>
                            setTouched((prev) => ({
                              ...prev,
                              [fieldName]: true,
                            }))
                          }
                        />
                      </div>
                      {hasError && (
                        <div className="reg-field-error">{error}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="kyc-upload-card">
            <div className="kyc-card-header">
              <span className="kyc-shield">🛡️</span>
              <div>
                <h3 className="kyc-card-title">KYC Document Upload</h3>
                <p className="kyc-card-hint">{config.kycHint}</p>
              </div>
            </div>
            <div className="reg-section-grid">
              <div className="reg-input-block">
                <label className="reg-label" htmlFor="document-type">
                  Document Type
                </label>
                <div className="reg-input-with-icon">
                  <span className="reg-input-icon" aria-hidden>
                    🪪
                  </span>
                  <select
                    id="document-type"
                    className="input reg-premium-input"
                    value={documentType}
                    onChange={(e) => {
                      setDocumentType(e.target.value);
                      setFormData((prev) => ({
                        ...prev,
                        documentType: e.target.value,
                      }));
                    }}
                  >
                    <option value="">Select Document Type</option>
                    <option value="PAN">PAN Card</option>
                    <option value="AADHAAR">Aadhaar Card</option>
                    <option value="DL">Driving License</option>
                    <option value="VOTER_ID">Voter ID</option>
                  </select>
                </div>
              </div>

              <div className="reg-input-block">
                <label className="reg-label" htmlFor="document-number">
                  Document Number
                </label>
                <div className="reg-input-with-icon">
                  <span className="reg-input-icon" aria-hidden>
                    #
                  </span>
                  <input
                    id="document-number"
                    type="text"
                    className="input reg-premium-input"
                    placeholder="Enter Document Number"
                    value={documentNumber}
                    onChange={(e) => {
                      setDocumentNumber(e.target.value.toUpperCase());
                      setFormData((prev) => ({
                        ...prev,
                        documentNumber: e.target.value.toUpperCase(),
                      }));
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="reg-file-drop-wrapper">
              <label className="reg-file-drop" htmlFor="document-file">
                <span className="reg-file-icon">
                  {selectedFile ? "📄" : "☁️"}
                </span>
                <span className="reg-file-text">
                  {selectedFile
                    ? selectedFile.name
                    : "Click to upload or drag & drop"}
                </span>
                <span className="reg-file-hint">Images or PDF, max 5MB</span>
                <input
                  id="document-file"
                  type="file"
                  className="reg-file-input"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    setSelectedFile(e.target.files[0]);
                    setFormData((prev) => ({
                      ...prev,
                      selectedFile: e.target.files[0] || null,
                    }));
                  }}
                />
              </label>
            </div>
          </div>

          <label className="checkbox-label reg-terms">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            <span>I agree to the Terms & Conditions</span>
          </label>

          {submitError && <div className="reg-submit-error">{submitError}</div>}
          {submitSuccess && (
            <div className="reg-submit-success">{submitSuccess}</div>
          )}

          <button
            type="button"
            className="btn btn-primary reg-submit-btn"
            onClick={handleSave}
            disabled={!canSubmit}
          >
            {submitting ? (
              <>
                <span className="reg-btn-spinner" aria-hidden />
                Submitting...
              </>
            ) : (
              "Register"
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
