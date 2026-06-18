import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ticketsBackend } from "../services/backendApis";
import { invalidateDashboardData } from "../services/dashboardInvalidate";
import { showError, showSuccess } from "../services/toast";
import "./Support.css";

export default function RaiseTicket() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ subject: "", message: "" });
  const [fieldErrors, setFieldErrors] = useState({});

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/support/chat");
    }
  };

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (String(form.subject || "").trim().length < 4) return false;
    if (String(form.message || "").trim().length < 10) return false;
    return true;
  }, [form, loading]);

  const submit = async () => {
    if (loading) return;
    setError("");
    const subject = String(form.subject || "").trim();
    const message = String(form.message || "").trim();
    const errs = {};
    if (subject.length < 4) errs.subject = "Subject is required (min 4 characters).";
    if (message.length < 10) errs.message = "Message is required (min 10 characters).";
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    try {
      // Send the backend-likely contract, plus compatibility keys.
      const payload = {
        subject,
        message,
        title: subject,
        description: message,
        // Compatibility: some backends require explicit status on creation to be visible in admin filters.
        status: "OPEN",
      };
      const res = await ticketsBackend.create(payload);
      const createdId = res?.id || res?.ticketId || res?.ticket?.id;
      invalidateDashboardData("ticket-created");
      showSuccess("Ticket created");
      if (createdId) {
        navigate(`/support/ticket/${encodeURIComponent(String(createdId))}`);
      } else {
        navigate("/support/chat");
      }
    } catch (e) {
      const msg = e?.message || "Failed to create ticket";
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="support-page">
      <div className="support-top-bar">
        <h2>Support Center</h2>
        <button
          type="button"
          onClick={handleBack}
          className="support-back-btn"
        >
          ← Back to My tickets
        </button>
      </div>

      <div className="support-glass-container">
        <div className="support-header-card">
          <h1>Ticket details</h1>
          <p className="subtitle">Tell us what you need and we'll get back quickly.</p>
        </div>

        <div className="ticket-raise-shell">
          <div className="support-form-card">
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
                fontWeight: 800,
              }}
            >
              {error}
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            style={{ display: "grid", gap: 12 }}
          >
            <div>
              <label style={labelStyle} htmlFor="ticket-title">
                Subject
              </label>
              <input
                id="ticket-title"
                value={form.subject}
                onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder="e.g. Payment failed but amount debited"
                className="support-input"
                style={inputStyle(Boolean(fieldErrors.subject))}
                disabled={loading}
              />
              {fieldErrors.subject ? (
                <div style={fieldErrorStyle}>{fieldErrors.subject}</div>
              ) : null}
            </div>

            <div>
              <label style={labelStyle} htmlFor="ticket-desc">
                Message
              </label>
              <textarea
                id="ticket-desc"
                value={form.message}
                onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                placeholder="Include steps, error messages, and any relevant details."
                className="support-textarea"
                style={{
                  ...inputStyle(Boolean(fieldErrors.message)),
                  minHeight: 160,
                  resize: "vertical",
                  lineHeight: 1.55,
                }}
                disabled={loading}
              />
              {fieldErrors.message ? (
                <div style={fieldErrorStyle}>{fieldErrors.message}</div>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={!canSubmit || loading}
              className="support-submit-btn"
            >
              {loading ? "Submitting..." : "Submit ticket"}
            </button>
          </form>
        </div>

        <aside className="ticket-help-card">
          <h4>Tips to get a faster reply</h4>
          <p>Include what you were trying to do, what happened, and any error text you saw.</p>
          <span className="ticket-help-pill">What you expected vs what happened</span>
          <span className="ticket-help-pill">Steps to reproduce (if possible)</span>
          <span className="ticket-help-pill">Screenshots (if available)</span>
        </aside>
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
  borderRadius: 12,
  border: `1px solid ${invalid ? "#fecaca" : "#d1d5db"}`,
  padding: "14px 18px",
  outline: "none",
  background: "#fff",
  boxShadow: invalid ? "0 0 0 3px rgba(239,68,68,0.12)" : "none",
});

