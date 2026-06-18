import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import ReferralCodeField from "../components/ReferralCodeField";
import { buildApiRequestUrl } from "../services/apiConfig";
import {
  clearStoredReferralRef,
  resolveReferralCodeForSubmit,
  resolveReferralInviteState,
} from "../utils/referralStorage";
import "./Registration.css";

const REGISTER_URL = buildApiRequestUrl("/register");

const INDIVIDUAL_FIELDS = [
  { name: "fullName", placeholder: "Full Name", col: "left" },
  { name: "email", placeholder: "Email Address", col: "right" },
  { name: "password", placeholder: "Password", col: "left" },
  { name: "phone", placeholder: "Phone Number", col: "right" },
  { name: "city", placeholder: "City", col: "left" },
  { name: "zip", placeholder: "ZIP Code", col: "right" },
  { name: "street", placeholder: "Street Address", col: "left" },
  { name: "referral", placeholder: "Referral Code / Name", col: "right" },
];

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

const ALLOWED_DOCUMENT_TYPES = ["PAN", "AADHAAR", "DL", "VOTER_ID"];

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

function getFieldLabel(fieldName) {
  const map = {
    fullName: "Full Name",
    email: "Email Address",
    password: "Password",
    phone: "Phone Number",
    city: "City",
    zip: "ZIP Code",
    street: "Street Address",
    referral: "Referral Code / Name",
  };
  return map[fieldName] || fieldName;
}

function getFieldIcon(fieldName) {
  const map = {
    fullName: "👤",
    email: "✉️",
    password: "🔒",
    phone: "☎️",
    city: "📍",
    zip: "🏷️",
    street: "🏠",
    referral: "🎟️",
  };
  return map[fieldName] || "•";
}

export default function IndividualRegistration() {
  const navigate = useNavigate();
  const location = useLocation();
  const [formData, setFormData] = useState({});
  const [referralLocked, setReferralLocked] = useState(false);
  const [documentType, setDocumentType] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [submitError, setSubmitError] = useState("");

  const sections = useMemo(
    () => [
      {
        title: "Personal Info",
        subtitle: "Your identity basics.",
        fields: ["fullName"],
      },
      {
        title: "Contact Details",
        subtitle: "Where we can reach you.",
        fields: ["email", "phone", "city", "zip", "street"],
      },
      {
        title: "Account Setup",
        subtitle: "Create your credentials.",
        fields: ["password", "referral"],
      },
    ],
    [],
  );

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

  const requiredFields = useMemo(
    () => ["fullName", "email", "password", "phone", "city", "zip", "street"],
    [],
  );

  const draftErrors = useMemo(() => {
    const errors = {};
    requiredFields.forEach((name) => {
      const value = formData[name];
      if (!String(value || "").trim()) {
        errors[name] = `${getFieldLabel(name)} is required.`;
        return;
      }
      if (name === "email" && !validateEmail(value))
        errors[name] = "Enter a valid email address.";
      if (name === "phone" && !validatePhone(value))
        errors[name] = "Enter a valid phone number.";
      if (name === "password" && !validatePassword(value))
        errors[name] = "Password must be at least 6 characters.";
    });
    return errors;
  }, [formData, requiredFields]);

  const canSubmit =
    !submitting && termsAccepted && Object.keys(draftErrors).length === 0;

  const getPlaceholder = (fieldName) =>
    INDIVIDUAL_FIELDS.find((f) => f.name === fieldName)?.placeholder ||
    getFieldLabel(fieldName);

  const handleSave = async () => {
    setSubmitError("");
    setSubmitSuccess("");
    setTouched((prev) => {
      const next = { ...prev };
      requiredFields.forEach((f) => {
        next[f] = true;
      });
      return next;
    });

    if (!canSubmit) {
      setSubmitError("Please fix the highlighted fields and try again.");
      return;
    }

    const selectedDocument = selectedFile;
    if (!selectedDocument) {
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

    const fileType = String(selectedDocument?.type || "").toLowerCase();
    if (
      fileType &&
      !fileType.startsWith("image/") &&
      fileType !== "application/pdf"
    ) {
      setSubmitError("Please upload a valid image or PDF document");
      return;
    }

    setSubmitting(true);
    try {
      const type = "individual";
      const payload = new FormData();
      payload.append("file", selectedDocument);
      payload.append("documentType", documentType);
      payload.append("documentNumber", documentNumber);
      payload.append(
        "entityType",
        type === "organization" ? "Organization" : "Individual",
      );
      payload.append(
        "name",
        formData.fullName || formData.orgName || formData.contactName || "",
      );
      payload.append("email", String(formData.email || ""));
      payload.append("phoneNumber", String(formData.phone || ""));
      payload.append("password", String(formData.password || ""));

      const referralCode = resolveReferralCodeForSubmit(formData.referral);
      if (referralCode) {
        payload.append("referralCode", referralCode);
      }

      const response = await fetch(REGISTER_URL, {
        method: "POST",
        body: payload,
        credentials: "include",
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.message || "Registration failed");
      }

      setSubmitSuccess("Registration submitted successfully.");
      clearStoredReferralRef();
      setDocumentType("");
      setDocumentNumber("");
      setSelectedFile(null);
      setTimeout(() => navigate("/login"), 850);
    } catch (e) {
      setSubmitError(
        e?.message || "Unable to submit registration. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-gradient registration-page">
      <div className="card-container registration-card">
        <header className="reg-header">
          <Logo to="/" />
          <Link to="/login">
            <button type="button" className="btn btn-primary">
              Login
            </button>
          </Link>
        </header>

        <h1 className="reg-title">Individual Registration Page</h1>
        <p className="reg-subtitle">
          Enter your details to create a new account.
        </p>

        <div className="reg-tabs">
          <button type="button" className="reg-tab active">
            <span className="tab-icon">👤</span>
            Individual Registration
          </button>
          <button
            type="button"
            className="reg-tab"
            onClick={() => navigate("/register/organization")}
          >
            <span className="tab-icon">💼</span>
            Organization Registration
          </button>
        </div>

        <div className="reg-form-title">Create your account</div>

        {sections.map((section) => (
          <div key={section.title} className="reg-section-card">
            <div className="reg-section-head">
              <div>
                <h3 className="reg-section-title">{section.title}</h3>
                <p className="reg-section-sub">{section.subtitle}</p>
              </div>
            </div>
            <div className="reg-section-grid">
              {section.fields.map((fieldName) => {
                const error = touched[fieldName] ? draftErrors[fieldName] : "";
                const showError = !!error;
                const value = formData[fieldName] || "";

                if (fieldName === "referral") {
                  return (
                    <ReferralCodeField
                      key={fieldName}
                      id="individual-referral"
                      value={value}
                      locked={referralLocked}
                      placeholder={getPlaceholder(fieldName)}
                      error={showError ? error : ""}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          [fieldName]: e.target.value,
                        }))
                      }
                      onBlur={() =>
                        setTouched((prev) => ({ ...prev, [fieldName]: true }))
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
                      className={`reg-input-with-icon ${showError ? "reg-input-invalid" : ""}`}
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
                        placeholder={getPlaceholder(fieldName)}
                        value={value}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            [fieldName]: e.target.value,
                          }))
                        }
                        onBlur={() =>
                          setTouched((prev) => ({ ...prev, [fieldName]: true }))
                        }
                      />
                    </div>
                    {showError && (
                      <div className="reg-field-error">{error}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <h3 className="kyc-title">KYC DOCUMENTS UPLOAD</h3>
        <div className="kyc-upload">
          <div className="kyc-cloud">☁</div>
          <p className="kyc-label">UPLOAD ID PROOF</p>
          <p className="kyc-hint">Addhar card, Passport, vote id.</p>
          <div className="reg-section-grid">
            <div className="reg-input-block">
              <label className="reg-label" htmlFor="individual-document-type">
                Document Type
              </label>
              <div className="reg-input-with-icon">
                <span className="reg-input-icon" aria-hidden>
                  🪪
                </span>
                <select
                  id="individual-document-type"
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
                  <option value="PAN">PAN</option>
                  <option value="AADHAAR">Aadhaar</option>
                  <option value="DL">Driving License</option>
                  <option value="VOTER_ID">Voter ID</option>
                </select>
              </div>
            </div>

            <div className="reg-input-block">
              <label className="reg-label" htmlFor="individual-document-number">
                Document Number
              </label>
              <div className="reg-input-with-icon">
                <span className="reg-input-icon" aria-hidden>
                  #
                </span>
                <input
                  id="individual-document-number"
                  type="text"
                  className="input reg-premium-input"
                  placeholder="Enter Document Number"
                  value={documentNumber}
                  onChange={(e) => {
                    setDocumentNumber(e.target.value);
                    setFormData((prev) => ({
                      ...prev,
                      documentNumber: e.target.value,
                    }));
                  }}
                />
              </div>
            </div>

            <div className="reg-input-block">
              <label className="reg-label" htmlFor="individual-document-file">
                Document Upload
              </label>
              <div className="reg-input-with-icon">
                <span className="reg-input-icon" aria-hidden>
                  📎
                </span>
                <input
                  id="individual-document-file"
                  type="file"
                  className="input reg-premium-input"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    setSelectedFile(e.target.files[0]);
                    setFormData((prev) => ({
                      ...prev,
                      selectedFile: e.target.files[0] || null,
                    }));
                  }}
                />
              </div>
            </div>
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
          className="btn btn-primary btn-save reg-submit-btn"
          onClick={handleSave}
          disabled={!canSubmit}
        >
          {submitting ? (
            <>
              <span className="reg-btn-spinner" aria-hidden />
              Submitting...
            </>
          ) : (
            "SAVE"
          )}
        </button>
      </div>
    </div>
  );
}
