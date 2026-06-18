import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { PageEmpty, PageError } from "../components/PageStates";
import { sessionsBackend, settingsBackend } from "../services/backendApis";
import { showError, showSuccess } from "../services/toast";
import "./Settings.css";

const LOCAL_BACKEND_FALLBACK_KEY = "ui-local-settings-fallback";
const LOCAL_EXTRAS_KEY = "ui-settings-center-extras";
const APP_VERSION = "1.0.0";

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stableStringify(obj) {
  const keys = Object.keys(obj || {}).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

const NAV_ITEMS = [
  { id: "general", label: "General" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy" },
  { id: "devices", label: "Devices" },
  { id: "account", label: "Account" },
];

function formatWhen(value) {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return String(value);
  return new Date(t).toLocaleString();
}

function guessIsCurrentSession(s, idx) {
  if (s?.current === true) return true;
  if (s?.isCurrent === true) return true;
  if (s?.active === true && s?.current === undefined && idx === 0) return true;
  return false;
}

function normalizeSessionsResponse(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.sessions)) return data.sessions;
  if (Array.isArray(data?.content)) return data.content;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function sessionRemoteId(s) {
  const v = s?.id ?? s?.sessionId ?? s?.sessionTokenId ?? s?.jti;
  if (v === undefined || v === null) return null;
  const str = String(v).trim();
  return str === "" ? null : str;
}

function sessionRowKey(s, idx) {
  return String(sessionRemoteId(s) ?? s?.device ?? idx);
}

function SessionDeviceCard({ s, idx, revokingId, onLogoutDevice }) {
  const isCurrent = guessIsCurrentSession(s, idx);
  const rid = sessionRemoteId(s);
  const device = s?.device || s?.deviceName || s?.platform || "Device";
  const browser = s?.browser || s?.userAgent || "Browser";
  const when = formatWhen(s?.lastSeenAt || s?.lastActiveAt || s?.createdAt);
  const ip = s?.ipAddress || s?.ip || s?.clientIp;
  return (
    <div className="sc-device-card">
      <div className="sc-device-top">
        <div className="sc-device-title">{device}</div>
        {isCurrent ? <Badge tone="info">This device</Badge> : null}
      </div>
      <div className={`sc-device-meta${ip ? " sc-device-meta--with-ip" : ""}`}>
        <div>
          <span>Browser / client</span>
          <strong title={String(browser)}>{String(browser).slice(0, 52)}</strong>
        </div>
        <div>
          <span>Last active</span>
          <strong>{when}</strong>
        </div>
        {ip ? (
          <div className="sc-device-ip">
            <div>
              <span>IP address</span>
              <strong>{String(ip)}</strong>
            </div>
          </div>
        ) : null}
      </div>
      <div className="sc-device-actions">
        {!isCurrent && rid ? (
          <button
            type="button"
            className="sc-btn sc-btn--ghost sc-btn--session-out"
            disabled={revokingId === rid}
            onClick={() => onLogoutDevice(rid)}
          >
            {revokingId === rid ? "Signing out…" : "Log out this device"}
          </button>
        ) : isCurrent ? (
          <p className="sc-device-hint">
            Use the header menu → Logout to sign out on this browser.
          </p>
        ) : (
          <p className="sc-device-hint">No session id from server — remote sign-out unavailable.</p>
        )}
      </div>
    </div>
  );
}

function Badge({ children, tone = "info" }) {
  return <span className={`sc-badge sc-badge--${tone}`}>{children}</span>;
}

function SectionIcon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
  };
  const strokeProps = {
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (name === "security") {
    return (
      <svg {...common}>
        <path
          {...strokeProps}
          d="M12 3l7 4v6c0 5-3 8-7 8s-7-3-7-8V7l7-4z"
        />
        <path {...strokeProps} d="M9.5 12.5l1.7 1.7 3.8-3.8" />
      </svg>
    );
  }
  if (name === "notifications") {
    return (
      <svg {...common}>
        <path
          {...strokeProps}
          d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        />
        <path {...strokeProps} d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    );
  }
  if (name === "privacy") {
    return (
      <svg {...common}>
        <path {...strokeProps} d="M12 3l8 4v6c0 5-3.5 8-8 8s-8-3-8-8V7l8-4z" />
        <path {...strokeProps} d="M9 12a3 3 0 0 1 6 0v1H9v-1z" />
      </svg>
    );
  }
  if (name === "device") {
    return (
      <svg {...common}>
        <path {...strokeProps} d="M12 1v2" />
        <path {...strokeProps} d="M12 21v2" />
        <path {...strokeProps} d="M4.2 4.2l1.4 1.4" />
        <path {...strokeProps} d="M18.4 18.4l1.4 1.4" />
        <path {...strokeProps} d="M1 12h2" />
        <path {...strokeProps} d="M21 12h2" />
        <path {...strokeProps} d="M4.2 19.8l1.4-1.4" />
        <path {...strokeProps} d="M18.4 5.6l1.4-1.4" />
        <path {...strokeProps} d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
      </svg>
    );
  }
  if (name === "account") {
    return (
      <svg {...common}>
        <path {...strokeProps} d="M20 21a8 8 0 0 0-16 0" />
        <path {...strokeProps} d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4z" />
      </svg>
    );
  }
  return null;
}

function Card({ icon, title, right, children }) {
  return (
    <section className="sc-card settings-card">
      <div className="sc-card-head">
        <div className="sc-card-title">
          <span className="sc-card-ico" aria-hidden>
            <SectionIcon name={icon} />
          </span>
          <h2>{title}</h2>
        </div>
        {right ? <div className="sc-card-right">{right}</div> : null}
      </div>
      <div className="sc-card-body">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  badge,
}) {
  return (
    <div className={`sc-row ${disabled ? "sc-row--disabled" : ""}`}>
      <div className="sc-row-left">
        <div className="sc-row-label">
          <span>{label}</span>
          {badge ? <span className="sc-row-badge">{badge}</span> : null}
        </div>
        {description ? <div className="sc-row-desc">{description}</div> : null}
      </div>
      <button
        type="button"
        className={`sc-switch ${checked ? "sc-switch--on" : ""}`}
        onClick={disabled ? undefined : onChange}
        aria-pressed={checked}
        disabled={disabled}
      >
        <span className="sc-switch-knob" />
      </button>
    </div>
  );
}

function ActionRow({ label, description, children, tone = "default" }) {
  return (
    <div className={`sc-row sc-row--action sc-row--${tone}`}>
      <div className="sc-row-left">
        <div className="sc-row-label">
          <span>{label}</span>
        </div>
        {description ? <div className="sc-row-desc">{description}</div> : null}
      </div>
      <div className="sc-row-actions">{children}</div>
    </div>
  );
}

function PrimaryButton({ children, disabled, onClick }) {
  return (
    <button type="button" className="sc-btn sc-btn--primary" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function GhostButton({ children, disabled, onClick }) {
  return (
    <button type="button" className="sc-btn sc-btn--ghost" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function DangerButton({ children, disabled, onClick }) {
  return (
    <button type="button" className="sc-btn sc-btn--danger" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="sc-card sc-card--skeleton" aria-hidden>
      <div className="sc-sk-head">
        <div className="sc-sk-ico" />
        <div className="sc-sk-lines">
          <div className="sc-sk-line sc-sk-line--title" />
          <div className="sc-sk-line sc-sk-line--sub" />
        </div>
      </div>
      <div className="sc-sk-body">
        <div className="sc-sk-row" />
        <div className="sc-sk-row" />
        <div className="sc-sk-row" />
      </div>
    </div>
  );
}

function Modal({ open, title, subtitle, children, onClose }) {
  if (!open) return null;
  return (
    <div className="sc-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sc-modal">
        <div className="sc-modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="sc-modal-title">{title}</div>
            {subtitle ? <div className="sc-modal-subtitle">{subtitle}</div> : null}
          </div>
          <button type="button" className="sc-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="sc-modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", error = "", disabled }) {
  return (
    <div className="sc-field">
      <label className="sc-field-label">
        {label}
        <input
          className={`sc-field-input ${error ? "sc-field-input--error" : ""}`}
          value={value}
          type={type}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={type === "password" ? "new-password" : "off"}
        />
      </label>
      {error ? <div className="sc-field-error">{error}</div> : null}
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [settings, setSettings] = useState(null);
  const [fallbackLocal, setFallbackLocal] = useState(false);
  const [fallbackReason, setFallbackReason] = useState(""); // "server" | "network" | ""

  const [draft, setDraft] = useState({
    notificationsEnabled: true,
    emailAlerts: true,
    darkMode: theme === "dark",
  });

  const [extras, setExtras] = useState(() => {
    const saved = safeJsonParse(window.localStorage.getItem(LOCAL_EXTRAS_KEY));
    return {
      ticketUpdates: saved?.ticketUpdates !== undefined ? Boolean(saved.ticketUpdates) : true,
      paymentAlerts: saved?.paymentAlerts !== undefined ? Boolean(saved.paymentAlerts) : true,
      marketingEmails: saved?.marketingEmails !== undefined ? Boolean(saved.marketingEmails) : false,

      manageConsent: saved?.manageConsent !== undefined ? Boolean(saved.manageConsent) : true,
      activityTracking:
        saved?.activityTracking !== undefined ? Boolean(saved.activityTracking) : false,
      personalizedRecs:
        saved?.personalizedRecs !== undefined ? Boolean(saved.personalizedRecs) : true,
    };
  });

  const baselineRef = useRef({ draft: null, extras: null });
  const sectionRefs = useRef({});
  const [activeSection, setActiveSection] = useState("general");
  const [lastSavedAt, setLastSavedAt] = useState(0);
  const [saveBanner, setSaveBanner] = useState({ tone: "success", text: "" });
  const saveBannerTimerRef = useRef(null);

  const tabRefs = useRef({});
  const navRefs = useRef({});

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [revokingSessionId, setRevokingSessionId] = useState(null);

  const [exporting, setExporting] = useState(false);

  const [modalChangePw, setModalChangePw] = useState(false);
  const [changePw, setChangePw] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [changePwErrors, setChangePwErrors] = useState({});
  const [changePwLoading, setChangePwLoading] = useState(false);

  const [modalLogoutAll, setModalLogoutAll] = useState(false);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);

  const [modalDeactivate, setModalDeactivate] = useState(false);
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  const appearance = useMemo(
    () => ({
      darkMode: theme === "dark",
    }),
    [theme],
  );

  const formDisabled = loading || saving || Boolean(error) || (!settings && !fallbackLocal);

  const isDirty = useMemo(() => {
    if (!baselineRef.current.draft || !baselineRef.current.extras) return false;
    return (
      stableStringify(baselineRef.current.draft) !== stableStringify(draft) ||
      stableStringify(baselineRef.current.extras) !== stableStringify(extras)
    );
  }, [draft, extras]);

  const discardToBaseline = () => {
    const baseDraft = baselineRef.current?.draft;
    const baseExtras = baselineRef.current?.extras;
    if (baseDraft) setDraft(baseDraft);
    if (baseExtras) setExtras(baseExtras);
    // Theme is driven off draft.darkMode via useEffect, so it will follow.
  };

  const setTransientSaveBanner = (tone, text, ms = 2600) => {
    setSaveBanner({ tone, text });
    if (saveBannerTimerRef.current) window.clearTimeout(saveBannerTimerRef.current);
    saveBannerTimerRef.current = window.setTimeout(() => {
      setSaveBanner({ tone: "success", text: "" });
    }, ms);
  };

  useEffect(() => {
    return () => {
      if (saveBannerTimerRef.current) window.clearTimeout(saveBannerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (!isDirty || saving) return;
      e.preventDefault();
      // Chrome requires returnValue to be set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty, saving]);

  const persistExtras = (next) => {
    window.localStorage.setItem(LOCAL_EXTRAS_KEY, JSON.stringify(next));
  };

  const loadSessions = async () => {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const data = await sessionsBackend.list();
      setSessions(normalizeSessionsResponse(data));
    } catch (e) {
      setSessions([]);
      setSessionsError(e?.message || "Failed to load sessions.");
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleLogoutSession = async (sessionId) => {
    if (!sessionId) return;
    setRevokingSessionId(sessionId);
    try {
      await sessionsBackend.revoke(sessionId);
      showSuccess("That device was signed out.");
      await loadSessions();
    } catch (e) {
      showError(e?.message || "Could not sign out that session.");
    } finally {
      setRevokingSessionId(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await settingsBackend.me();
      setSettings(data ?? null);
      setFallbackLocal(false);
      setFallbackReason("");

      const nextDraft = {
        notificationsEnabled:
          data?.notificationsEnabled !== undefined ? Boolean(data.notificationsEnabled) : true,
        emailAlerts: data?.emailAlerts !== undefined ? Boolean(data.emailAlerts) : true,
        darkMode:
          data?.darkMode !== undefined ? Boolean(data.darkMode) : appearance.darkMode,
      };

      setDraft(nextDraft);
      setTheme(nextDraft.darkMode ? "dark" : "light");

      baselineRef.current = { draft: nextDraft, extras };
    } catch (e) {
      const status = Number(e?.status) || 0;
      setSettings(null);

      if (status >= 500 || !status) {
        const saved = safeJsonParse(window.localStorage.getItem(LOCAL_BACKEND_FALLBACK_KEY));
        const nextDraft = {
          notificationsEnabled:
            saved?.notificationsEnabled !== undefined ? Boolean(saved.notificationsEnabled) : true,
          emailAlerts: saved?.emailAlerts !== undefined ? Boolean(saved.emailAlerts) : true,
          darkMode:
            saved?.darkMode !== undefined ? Boolean(saved.darkMode) : appearance.darkMode,
        };
        setDraft(nextDraft);
        setTheme(nextDraft.darkMode ? "dark" : "light");
        setFallbackLocal(true);
        setFallbackReason(status >= 500 ? "server" : "network");
        setError("");

        baselineRef.current = { draft: nextDraft, extras };
      } else {
        setFallbackLocal(false);
        setFallbackReason("");
        setError(e?.message || "Failed to load settings.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    setTheme(draft.darkMode ? "dark" : "light");
  }, [draft.darkMode]);

  useEffect(() => {
    persistExtras(extras);
  }, [extras]);

  const save = async () => {
    if (saving || !isDirty) return;
    setSaving(true);
    try {
      const payload = {
        notificationsEnabled: Boolean(draft.notificationsEnabled),
        emailAlerts: Boolean(draft.emailAlerts),
        darkMode: Boolean(draft.darkMode),
      };

      // Always attempt backend save for the confirmed fields.
      await settingsBackend.update(payload);

      setFallbackLocal(false);
      setFallbackReason("");
      setSettings((prev) => prev ?? payload);

      // Update both baselines after successful save.
      baselineRef.current = { draft: payload, extras };
      window.localStorage.setItem(LOCAL_BACKEND_FALLBACK_KEY, JSON.stringify(payload));

      setLastSavedAt(Date.now());
      setTransientSaveBanner("success", "Saved");
      showSuccess("Settings saved");
      await load();
    } catch (e) {
      const status = Number(e?.status) || 0;
      if (status >= 500 || !status) {
        const payload = {
          notificationsEnabled: Boolean(draft.notificationsEnabled),
          emailAlerts: Boolean(draft.emailAlerts),
          darkMode: Boolean(draft.darkMode),
        };
        window.localStorage.setItem(LOCAL_BACKEND_FALLBACK_KEY, JSON.stringify(payload));
        setFallbackLocal(true);
        setFallbackReason(status >= 500 ? "server" : "network");
        setLastSavedAt(Date.now());
        setTransientSaveBanner("warning", "Saved locally");
        showError(
          status >= 500
            ? "Server error — saved locally. Try again later."
            : "Network/CORS error — saved locally. Check connection and try again.",
        );
        baselineRef.current = { draft: payload, extras };
      } else {
        setTransientSaveBanner("danger", "Save failed");
        showError(e?.message || "Failed to save settings");
      }
    } finally {
      setSaving(false);
    }
  };

  const clearCache = () => {
    window.localStorage.removeItem(LOCAL_BACKEND_FALLBACK_KEY);
    window.localStorage.removeItem(LOCAL_EXTRAS_KEY);
    showSuccess("Cache cleared");
  };

  const scrollTo = (id) => {
    if (saving) return;
    if (isDirty) {
      const ok = window.confirm("You have unsaved changes. Discard them and switch sections?");
      if (!ok) return;
      discardToBaseline();
    }
    setActiveSection(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    // Intersection observer no longer required.
    return undefined;
  }, []);

  const downloadExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await settingsBackend.exportBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `user-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showSuccess("Export download started");
    } catch (e) {
      showError(e?.message || "Failed to export data");
    } finally {
      setExporting(false);
    }
  };

  const submitChangePassword = async () => {
    if (changePwLoading) return;
    const currentPassword = String(changePw.currentPassword || "");
    const newPassword = String(changePw.newPassword || "");
    const confirmPassword = String(changePw.confirmPassword || "");
    const errs = {};
    if (!currentPassword.trim()) errs.currentPassword = "Current password is required.";
    if (newPassword.trim().length < 6) errs.newPassword = "Password must be at least 6 characters.";
    if (confirmPassword !== newPassword) errs.confirmPassword = "Passwords do not match.";
    setChangePwErrors(errs);
    if (Object.keys(errs).length) return;

    setChangePwLoading(true);
    try {
      await settingsBackend.changePassword({ currentPassword, newPassword, confirmPassword });
      showSuccess("Password updated");
      setModalChangePw(false);
      setChangePw({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setChangePwErrors({});
    } catch (e) {
      showError(e?.message || "Failed to change password");
    } finally {
      setChangePwLoading(false);
    }
  };

  const submitLogoutAll = async () => {
    if (logoutAllLoading) return;
    setLogoutAllLoading(true);
    try {
      await settingsBackend.logoutAll();
      showSuccess("Logged out from other devices");
      setModalLogoutAll(false);
      await loadSessions();
    } catch (e) {
      showError(e?.message || "Failed to logout all devices");
    } finally {
      setLogoutAllLoading(false);
    }
  };

  const submitDeactivate = async () => {
    if (deactivateLoading) return;
    setDeactivateLoading(true);
    try {
      await settingsBackend.deactivate({});
      showSuccess("Account deactivated");
      logout();
      navigate("/login", { replace: true, state: { message: "Account deactivated." } });
    } catch (e) {
      showError(e?.message || "Failed to deactivate account");
    } finally {
      setDeactivateLoading(false);
      setModalDeactivate(false);
    }
  };

  const renderSection = () => {
    switch (activeSection) {
      case "general":
        return (
          <Card
            icon="device"
            title="General"
            right={fallbackLocal ? <Badge tone="local">Local</Badge> : null}
          >
            <div className="sc-stack">
              <ToggleRow
                label="Dark mode"
                description="Switch between light and dark theme."
                checked={draft.darkMode}
                onChange={() => setDraft((p) => ({ ...p, darkMode: !p.darkMode }))}
                disabled={formDisabled}
              />
              <ToggleRow
                label="Email alerts"
                description="Receive important alerts via email."
                checked={draft.emailAlerts}
                onChange={() => setDraft((p) => ({ ...p, emailAlerts: !p.emailAlerts }))}
                disabled={formDisabled}
              />
              <ToggleRow
                label="In-app notifications"
                description="Enable in-app notifications."
                checked={draft.notificationsEnabled}
                onChange={() =>
                  setDraft((p) => ({ ...p, notificationsEnabled: !p.notificationsEnabled }))
                }
                disabled={formDisabled}
              />
            </div>
          </Card>
        );

      case "security":
        return (
          <Card icon="security" title="Security" right={<Badge tone="info">Protected</Badge>}>
            <div className="sc-stack">
              <ActionRow
                label="Change password"
                description="Update your password to keep your account secure."
              >
                <GhostButton disabled={saving} onClick={() => setModalChangePw(true)}>
                  Change Password
                </GhostButton>
              </ActionRow>

              <ActionRow
                label="Logout from all devices"
                description="Sign out of all active sessions across devices."
                tone="danger"
              >
                <GhostButton disabled={saving} onClick={() => setModalLogoutAll(true)}>
                  Logout All
                </GhostButton>
              </ActionRow>

              <ToggleRow
                label="Two-factor authentication"
                description="Add an extra layer of security at login."
                checked={false}
                onChange={() => {}}
                disabled
                badge={<Badge tone="soon">Coming soon</Badge>}
              />

              <div className="sc-subcard">
                <div className="sc-subcard-head">
                  <div className="sc-subcard-title">Sessions</div>
                  <button
                    type="button"
                    className="sc-link"
                    onClick={() => void loadSessions()}
                    disabled={sessionsLoading}
                  >
                    {sessionsLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                {sessionsError ? <div className="sc-mini-error">{sessionsError}</div> : null}
                {!sessionsLoading && sessions.length === 0 && !sessionsError ? (
                  <div className="sc-empty">
                    <div className="sc-empty-title">No sessions found</div>
                    <div className="sc-empty-sub">
                      If you just logged in, sessions may take a moment to appear. Use refresh to retry.
                    </div>
                    <div className="sc-empty-actions">
                      <GhostButton disabled={sessionsLoading} onClick={() => void loadSessions()}>
                        Refresh
                      </GhostButton>
                    </div>
                  </div>
                ) : null}
                {sessionsLoading && sessions.length === 0 ? (
                  <div className="sc-mini-muted">Loading sessions...</div>
                ) : null}

                {sessions.length > 0 ? (
                  <div className="sc-sessions-grid">
                    {sessions.map((s, idx) => (
                      <SessionDeviceCard
                        key={sessionRowKey(s, idx)}
                        s={s}
                        idx={idx}
                        revokingId={revokingSessionId}
                        onLogoutDevice={handleLogoutSession}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        );

      case "notifications":
        return (
          <Card icon="notifications" title="Notifications">
            <div className="sc-stack">
              <ToggleRow
                label="In-app notifications"
                description="Enable in-app notifications."
                checked={draft.notificationsEnabled}
                onChange={() =>
                  setDraft((p) => ({ ...p, notificationsEnabled: !p.notificationsEnabled }))
                }
                disabled={formDisabled}
              />
              <ToggleRow
                label="Email alerts"
                description="Receive important alerts via email."
                checked={draft.emailAlerts}
                onChange={() => setDraft((p) => ({ ...p, emailAlerts: !p.emailAlerts }))}
                disabled={formDisabled}
              />
              <ToggleRow
                label="Ticket updates"
                description="Get notified when your support ticket is updated."
                checked={extras.ticketUpdates}
                onChange={() => setExtras((p) => ({ ...p, ticketUpdates: !p.ticketUpdates }))}
                disabled={saving}
                badge={fallbackLocal ? <Badge tone="local">Local</Badge> : null}
              />
              <ToggleRow
                label="Payment alerts"
                description="Stay updated on payments and billing events."
                checked={extras.paymentAlerts}
                onChange={() => setExtras((p) => ({ ...p, paymentAlerts: !p.paymentAlerts }))}
                disabled={saving}
                badge={fallbackLocal ? <Badge tone="local">Local</Badge> : null}
              />
              <ToggleRow
                label="Marketing emails"
                description="Product updates and occasional offers."
                checked={extras.marketingEmails}
                onChange={() => setExtras((p) => ({ ...p, marketingEmails: !p.marketingEmails }))}
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
            </div>
          </Card>
        );

      case "privacy":
        return (
          <Card icon="privacy" title="Privacy">
            <div className="sc-stack">
              <ActionRow label="Export data" description="Download a copy of your data.">
                <GhostButton disabled={saving || exporting} onClick={() => void downloadExport()}>
                  {exporting ? "Preparing..." : "Download"}
                </GhostButton>
              </ActionRow>

              <ToggleRow
                label="Manage consent"
                description="Control consent preferences for data processing."
                checked={extras.manageConsent}
                onChange={() => setExtras((p) => ({ ...p, manageConsent: !p.manageConsent }))}
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
              <ToggleRow
                label="Activity tracking"
                description="Allow tracking to improve analytics and stability."
                checked={extras.activityTracking}
                onChange={() =>
                  setExtras((p) => ({ ...p, activityTracking: !p.activityTracking }))
                }
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
              <ToggleRow
                label="Personalized recommendations"
                description="Show recommendations based on usage."
                checked={extras.personalizedRecs}
                onChange={() =>
                  setExtras((p) => ({ ...p, personalizedRecs: !p.personalizedRecs }))
                }
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
            </div>
          </Card>
        );

      case "devices":
        return (
          <Card
            icon="device"
            title="Devices"
            right={
              <button
                type="button"
                className="sc-link"
                onClick={() => void loadSessions()}
                disabled={sessionsLoading}
              >
                {sessionsLoading ? "Refreshing..." : "Refresh"}
              </button>
            }
          >
            <div className="sc-stack">
              {sessionsError ? <div className="sc-mini-error">{sessionsError}</div> : null}
              {!sessionsLoading && sessions.length === 0 && !sessionsError ? (
                <div className="sc-empty">
                  <div className="sc-empty-title">No sessions found</div>
                  <div className="sc-empty-sub">
                    We’ll show your signed-in devices here. Use refresh to retry if this looks empty.
                  </div>
                  <div className="sc-empty-actions">
                    <GhostButton disabled={sessionsLoading} onClick={() => void loadSessions()}>
                      Refresh
                    </GhostButton>
                  </div>
                </div>
              ) : null}
              {sessionsLoading && sessions.length === 0 ? (
                <div className="sc-mini-muted">Loading sessions...</div>
              ) : null}
              {sessions.length > 0 ? (
                <div className="sc-sessions-grid">
                  {sessions.map((s, idx) => (
                    <SessionDeviceCard
                      key={sessionRowKey(s, idx)}
                      s={s}
                      idx={idx}
                      revokingId={revokingSessionId}
                      onLogoutDevice={handleLogoutSession}
                    />
                  ))}
                </div>
              ) : null}

              <div className="sc-divider" />
              <ActionRow label="Clear cache" description="Reset local preferences cache.">
                <GhostButton disabled={saving} onClick={clearCache}>
                  Clear Cache
                </GhostButton>
              </ActionRow>
            </div>
          </Card>
        );

      case "account":
      default:
        return (
          <Card icon="account" title="Account">
            <div className="sc-stack">
              <ActionRow label="Profile" description="View and edit your profile details.">
                <PrimaryButton disabled={saving} onClick={() => navigate("/profile")}>
                  Go to Profile
                </PrimaryButton>
              </ActionRow>

              <ActionRow label="Logout" description="Sign out of this device.">
                <GhostButton
                  disabled={saving}
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  Logout
                </GhostButton>
              </ActionRow>

              <div className="sc-dangerzone">
                <div className="sc-dangerzone-title">Danger zone</div>
                <div className="sc-dangerzone-sub">Deactivating your account is irreversible.</div>
                <div className="sc-dangerzone-actions">
                  <DangerButton disabled={saving} onClick={() => setModalDeactivate(true)}>
                    Deactivate account
                  </DangerButton>
                </div>
              </div>
            </div>
          </Card>
        );
    }
  };

  return (
    <div className="sc-page">
      <div className="sc-shell">
        <header className="sc-topbar">
          <div className="sc-topbar-left">
            <h1 className="sc-title">Settings</h1>
            <p className="sc-subtitle">
              Manage your account, security and preferences.
            </p>
          </div>

          <div className="sc-topbar-right">
            <div className="sc-save-meta" aria-live="polite">
              {saving ? (
                <span className="sc-save-pill sc-save-pill--saving">Saving…</span>
              ) : saveBanner.text ? (
                <span className={`sc-save-pill sc-save-pill--${saveBanner.tone}`}>
                  {saveBanner.text}
                </span>
              ) : lastSavedAt ? (
                <span className="sc-save-pill sc-save-pill--muted">
                  Saved {new Date(lastSavedAt).toLocaleTimeString()}
                </span>
              ) : null}
              {!saving && isDirty ? (
                <span className="sc-save-pill sc-save-pill--dirty">Unsaved changes</span>
              ) : null}
            </div>
            {isDirty ? (
              <PrimaryButton disabled={loading || saving} onClick={() => void save()}>
                {saving ? "Saving..." : "Save Changes"}
              </PrimaryButton>
            ) : null}
          </div>
        </header>

        <div className="sc-mobile-tabs" role="tablist" aria-label="Settings sections">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sc-tab ${activeSection === item.id ? "sc-tab--active" : ""}`}
              onClick={() => scrollTo(item.id)}
              role="tab"
              aria-selected={activeSection === item.id}
              aria-controls={`sc-panel-${item.id}`}
              id={`sc-tab-${item.id}`}
              ref={(el) => {
                tabRefs.current[item.id] = el;
              }}
              onKeyDown={(e) => {
                const idx = NAV_ITEMS.findIndex((x) => x.id === item.id);
                const go = (nextIdx) => {
                  const next = NAV_ITEMS[(nextIdx + NAV_ITEMS.length) % NAV_ITEMS.length];
                  const el = tabRefs.current[next.id];
                  if (el) el.focus();
                  scrollTo(next.id);
                };
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  go(idx + 1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  go(idx - 1);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  go(0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  go(NAV_ITEMS.length - 1);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {fallbackLocal ? (
          <div className="sc-banner sc-banner--warning">
            <strong>Local mode</strong>
            <span className="sc-banner-dot" aria-hidden />
            {fallbackReason === "network"
              ? "Network/CORS issue detected. You’re editing local preferences."
              : "Backend settings are temporarily unavailable. You’re editing local preferences."}
          </div>
        ) : null}

        {loading ? (
          <div className="sc-layout">
            <aside className="sc-nav">
              <div className="sc-nav-title">Settings</div>
              <div className="sc-nav-list">
                {NAV_ITEMS.map((i) => (
                  <div key={i.id} className="sc-nav-skel" />
                ))}
              </div>
            </aside>
            <main className="sc-content">
              <div className="sc-content-grid">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            </main>
          </div>
        ) : null}
        {!loading && error ? <PageError message={error} onRetry={() => void load()} /> : null}
        {!loading && !error && !settings && !fallbackLocal ? (
          <PageEmpty title="No settings found" subtitle="Try refreshing this page." />
        ) : null}

        {!loading && !error ? (
        <div className="sc-layout">
          <aside className="sc-nav" aria-label="Settings navigation">
            <div className="sc-nav-head">
              <div className="sc-nav-h1">Settings</div>
              <div className="sc-nav-h2">Account & preferences</div>
            </div>
            <div className="sc-nav-list">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`sc-nav-item ${activeSection === item.id ? "sc-nav-item--active" : ""}`}
                  onClick={() => scrollTo(item.id)}
                  aria-current={activeSection === item.id ? "page" : undefined}
                  ref={(el) => {
                    navRefs.current[item.id] = el;
                  }}
                  onKeyDown={(e) => {
                    const idx = NAV_ITEMS.findIndex((x) => x.id === item.id);
                    const focusOnly = (nextIdx) => {
                      const next = NAV_ITEMS[(nextIdx + NAV_ITEMS.length) % NAV_ITEMS.length];
                      const el = navRefs.current[next.id];
                      if (el) el.focus();
                    };
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      focusOnly(idx + 1);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      focusOnly(idx - 1);
                    } else if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      scrollTo(item.id);
                    } else if (e.key === "Home") {
                      e.preventDefault();
                      focusOnly(0);
                    } else if (e.key === "End") {
                      e.preventDefault();
                      focusOnly(NAV_ITEMS.length - 1);
                    }
                  }}
                >
                  <span className="sc-nav-dot" aria-hidden />
                  <span className="sc-nav-label">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="sc-nav-foot">
              <div className="sc-nav-foot-k">App version</div>
              <div className="sc-nav-foot-v">v{APP_VERSION}</div>
            </div>
          </aside>

          <main className="sc-content" aria-live="polite">
            <div key={activeSection} className="sc-content-grid sc-content-grid--single sc-panel">
        {activeSection === "general" ? (
          <div
            className="sc-section"
            id="sc-panel-general"
            role="tabpanel"
            aria-labelledby="sc-tab-general"
            data-section-id="general"
            ref={(el) => {
              sectionRefs.current.general = el;
            }}
          >
          <Card icon="device" title="General" right={fallbackLocal ? <Badge tone="local">Local</Badge> : null}>
            <div className="sc-stack">
              <ToggleRow
                label="Dark mode"
                description="Switch between light and dark theme."
                checked={draft.darkMode}
                onChange={() => setDraft((p) => ({ ...p, darkMode: !p.darkMode }))}
                disabled={formDisabled}
              />
              <ToggleRow
                label="Email alerts"
                description="Receive important alerts via email."
                checked={draft.emailAlerts}
                onChange={() => setDraft((p) => ({ ...p, emailAlerts: !p.emailAlerts }))}
                disabled={formDisabled}
              />
              <ToggleRow
                label="In-app notifications"
                description="Enable in-app notifications."
                checked={draft.notificationsEnabled}
                onChange={() =>
                  setDraft((p) => ({ ...p, notificationsEnabled: !p.notificationsEnabled }))
                }
                disabled={formDisabled}
              />
            </div>
          </Card>
          </div>
        ) : null}

        {activeSection === "security" ? (
          <div
            className="sc-section"
            id="sc-panel-security"
            role="tabpanel"
            aria-labelledby="sc-tab-security"
            data-section-id="security"
            ref={(el) => {
              sectionRefs.current.security = el;
            }}
          >
          <Card
            icon="security"
            title="Security"
            right={<Badge tone="info">Protected</Badge>}
          >
            <div className="sc-stack">
              <ActionRow
                label="Change password"
                description="Update your password to keep your account secure."
              >
                <GhostButton
                  disabled={saving}
                  onClick={() => setModalChangePw(true)}
                >
                  Change Password
                </GhostButton>
              </ActionRow>

              <ActionRow
                label="Logout from all devices"
                description="Sign out of all active sessions across devices."
                tone="danger"
              >
                <DangerButton
                  disabled={saving}
                  onClick={() => setModalLogoutAll(true)}
                >
                  Logout All
                </DangerButton>
              </ActionRow>

              <ToggleRow
                label="Two-factor authentication"
                description="Add an extra layer of security at login."
                checked={false}
                onChange={() => {}}
                disabled
                badge={<Badge tone="soon">Coming soon</Badge>}
              />

              <div className="sc-info">
                <div className="sc-info-title" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>Sessions</span>
                  <button
                    type="button"
                    className="sc-link"
                    onClick={() => void loadSessions()}
                    disabled={sessionsLoading}
                  >
                    {sessionsLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                {sessionsError ? <div className="sc-mini-error">{sessionsError}</div> : null}

                {sessionsLoading && sessions.length === 0 ? (
                  <div className="sc-mini-muted">Loading sessions...</div>
                ) : null}

                {!sessionsLoading && sessions.length === 0 && !sessionsError ? (
                  <div className="sc-mini-muted">No sessions found.</div>
                ) : null}

                {sessions.length > 0 ? (
                  <div className="sc-sessions-grid">
                    {sessions.slice(0, 6).map((s, idx) => (
                      <SessionDeviceCard
                        key={sessionRowKey(s, idx)}
                        s={s}
                        idx={idx}
                        revokingId={revokingSessionId}
                        onLogoutDevice={handleLogoutSession}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
          </div>
        ) : null}

        {activeSection === "notifications" ? (
            <div
              className="sc-section"
              id="sc-panel-notifications"
              role="tabpanel"
              aria-labelledby="sc-tab-notifications"
              data-section-id="notifications"
              ref={(el) => {
                sectionRefs.current.notifications = el;
              }}
            >
          <Card icon="notifications" title="Notifications">
            <div className="sc-stack">
              <ToggleRow
                label="In-app notifications"
                description="Enable in-app notifications."
                checked={draft.notificationsEnabled}
                onChange={() =>
                  setDraft((p) => ({ ...p, notificationsEnabled: !p.notificationsEnabled }))
                }
                disabled={formDisabled}
              />
              <ToggleRow
                label="Email alerts"
                description="Receive important alerts via email."
                checked={draft.emailAlerts}
                onChange={() => setDraft((p) => ({ ...p, emailAlerts: !p.emailAlerts }))}
                disabled={formDisabled}
              />
              <ToggleRow
                label="Ticket updates"
                description="Get notified when your support ticket is updated."
                checked={extras.ticketUpdates}
                onChange={() => setExtras((p) => ({ ...p, ticketUpdates: !p.ticketUpdates }))}
                disabled={saving}
                badge={fallbackLocal ? <Badge tone="local">Local</Badge> : null}
              />
              <ToggleRow
                label="Payment alerts"
                description="Stay updated on payments and billing events."
                checked={extras.paymentAlerts}
                onChange={() => setExtras((p) => ({ ...p, paymentAlerts: !p.paymentAlerts }))}
                disabled={saving}
                badge={fallbackLocal ? <Badge tone="local">Local</Badge> : null}
              />
              <ToggleRow
                label="Marketing emails"
                description="Product updates and occasional offers."
                checked={extras.marketingEmails}
                onChange={() => setExtras((p) => ({ ...p, marketingEmails: !p.marketingEmails }))}
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
            </div>
          </Card>
            </div>
          ) : null}

          {activeSection === "privacy" ? (
            <div
              className="sc-section"
              id="sc-panel-privacy"
              role="tabpanel"
              aria-labelledby="sc-tab-privacy"
              data-section-id="privacy"
              ref={(el) => {
                sectionRefs.current.privacy = el;
              }}
            >
          <Card icon="privacy" title="Privacy">
            <div className="sc-stack">
              <ActionRow
                label="Request data download"
                description="Download a copy of your data."
              >
                <GhostButton
                  disabled={saving || exporting}
                  onClick={() => void downloadExport()}
                >
                  {exporting ? "Preparing..." : "Download Data"}
                </GhostButton>
              </ActionRow>

              <ToggleRow
                label="Manage consent"
                description="Control consent preferences for data processing."
                checked={extras.manageConsent}
                onChange={() => setExtras((p) => ({ ...p, manageConsent: !p.manageConsent }))}
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
              <ToggleRow
                label="Activity tracking"
                description="Allow tracking to improve analytics and stability."
                checked={extras.activityTracking}
                onChange={() =>
                  setExtras((p) => ({ ...p, activityTracking: !p.activityTracking }))
                }
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
              <ToggleRow
                label="Personalized recommendations"
                description="Show recommendations based on usage."
                checked={extras.personalizedRecs}
                onChange={() =>
                  setExtras((p) => ({ ...p, personalizedRecs: !p.personalizedRecs }))
                }
                disabled={saving}
                badge={<Badge tone="local">Local</Badge>}
              />
            </div>
          </Card>
            </div>
          ) : null}

          {activeSection === "devices" ? (
            <div
              className="sc-section"
              id="sc-panel-devices"
              role="tabpanel"
              aria-labelledby="sc-tab-devices"
              data-section-id="devices"
              ref={(el) => {
                sectionRefs.current.devices = el;
              }}
            >
          <Card icon="device" title="Devices" right={
            <button
              type="button"
              className="sc-link"
              onClick={() => void loadSessions()}
              disabled={sessionsLoading}
            >
              {sessionsLoading ? "Refreshing..." : "Refresh"}
            </button>
          }>
            <div className="sc-stack">
              {sessionsError ? <div className="sc-mini-error">{sessionsError}</div> : null}
              {!sessionsLoading && sessions.length === 0 && !sessionsError ? (
                <div className="sc-empty">
                  <div className="sc-empty-title">No sessions found</div>
                  <div className="sc-empty-sub">Your active devices will appear here.</div>
                </div>
              ) : null}
              {sessionsLoading && sessions.length === 0 ? (
                <div className="sc-mini-muted">Loading sessions...</div>
              ) : null}
              {sessions.length > 0 ? (
                <div className="sc-sessions-grid">
                  {sessions.map((s, idx) => (
                    <SessionDeviceCard
                      key={sessionRowKey(s, idx)}
                      s={s}
                      idx={idx}
                      revokingId={revokingSessionId}
                      onLogoutDevice={handleLogoutSession}
                    />
                  ))}
                </div>
              ) : null}

              <div className="sc-divider" />

              <ActionRow label="Clear cache" description="Reset local preferences cache.">
                <GhostButton disabled={saving} onClick={clearCache}>
                  Clear Cache
                </GhostButton>
              </ActionRow>
            </div>
          </Card>
            </div>
          ) : null}

          {activeSection === "account" ? (
            <div
              className="sc-section"
              id="sc-panel-account"
              role="tabpanel"
              aria-labelledby="sc-tab-account"
              data-section-id="account"
              ref={(el) => {
                sectionRefs.current.account = el;
              }}
            >
          <Card icon="account" title="Account">
            <div className="sc-stack">
              <ActionRow label="Profile" description="View and edit your profile details.">
                <PrimaryButton disabled={saving} onClick={() => navigate("/profile")}>
                  Go to Profile
                </PrimaryButton>
              </ActionRow>

              <ActionRow label="Logout" description="Sign out of this device.">
                <GhostButton
                  disabled={saving}
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  Logout
                </GhostButton>
              </ActionRow>

              <div className="sc-dangerzone">
                <div className="sc-dangerzone-title">Danger zone</div>
                <div className="sc-dangerzone-sub">
                  Destructive actions are irreversible. Proceed carefully.
                </div>
                <div className="sc-dangerzone-actions">
                  <DangerButton disabled={saving} onClick={() => setModalDeactivate(true)}>
                    Deactivate account
                  </DangerButton>
                </div>
              </div>
            </div>
          </Card>
            </div>
          ) : null}
            </div>
          </main>
        </div>
        ) : null}
      </div>

      <Modal
        open={modalChangePw}
        title="Change password"
        subtitle="Use a strong password you don’t reuse elsewhere."
        onClose={() => {
          if (changePwLoading) return;
          setModalChangePw(false);
        }}
      >
        <Field
          label="Current password"
          type="password"
          value={changePw.currentPassword}
          onChange={(v) => setChangePw((p) => ({ ...p, currentPassword: v }))}
          error={changePwErrors.currentPassword}
          disabled={changePwLoading}
        />
        <Field
          label="New password"
          type="password"
          value={changePw.newPassword}
          onChange={(v) => setChangePw((p) => ({ ...p, newPassword: v }))}
          error={changePwErrors.newPassword}
          disabled={changePwLoading}
          placeholder="Minimum 6 characters"
        />
        <Field
          label="Confirm password"
          type="password"
          value={changePw.confirmPassword}
          onChange={(v) => setChangePw((p) => ({ ...p, confirmPassword: v }))}
          error={changePwErrors.confirmPassword}
          disabled={changePwLoading}
        />
        <div className="sc-modal-actions">
          <GhostButton disabled={changePwLoading} onClick={() => setModalChangePw(false)}>
            Cancel
          </GhostButton>
          <PrimaryButton disabled={changePwLoading} onClick={() => void submitChangePassword()}>
            {changePwLoading ? "Updating..." : "Update password"}
          </PrimaryButton>
        </div>
      </Modal>

      <Modal
        open={modalLogoutAll}
        title="Logout from all devices"
        subtitle="This will sign out all other sessions. Your current session may remain active."
        onClose={() => {
          if (logoutAllLoading) return;
          setModalLogoutAll(false);
        }}
      >
        <div className="sc-modal-note">
          Tip: After logout-all, you may be asked to login again if the backend revokes this session too.
        </div>
        <div className="sc-modal-actions">
          <GhostButton disabled={logoutAllLoading} onClick={() => setModalLogoutAll(false)}>
            Cancel
          </GhostButton>
          <DangerButton disabled={logoutAllLoading} onClick={() => void submitLogoutAll()}>
            {logoutAllLoading ? "Logging out..." : "Logout all"}
          </DangerButton>
        </div>
      </Modal>

      <Modal
        open={modalDeactivate}
        title="Deactivate account"
        subtitle="This action is irreversible. You will be logged out immediately."
        onClose={() => {
          if (deactivateLoading) return;
          setModalDeactivate(false);
        }}
      >
        <div className="sc-modal-danger">
          Deactivating your account will disable access and remove your active sessions.
        </div>
        <div className="sc-modal-actions">
          <GhostButton disabled={deactivateLoading} onClick={() => setModalDeactivate(false)}>
            Cancel
          </GhostButton>
          <DangerButton disabled={deactivateLoading} onClick={() => void submitDeactivate()}>
            {deactivateLoading ? "Deactivating..." : "Deactivate"}
          </DangerButton>
        </div>
      </Modal>
    </div>
  );
}

