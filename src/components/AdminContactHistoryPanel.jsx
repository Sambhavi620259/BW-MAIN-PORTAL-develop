import { useEffect, useState } from "react";
import { adminDashboardApi } from "../services/adminDashboardApi";

/** Backend history rows are keyed by external ids (USR-*, ADM-*), not numeric list ids. */
export function extractAdminUserExternalId(user) {
  if (!user || typeof user !== "object") return "";
  const raw = user._raw && typeof user._raw === "object" ? user._raw : user;
  const sources = [user, raw, user.user, raw.user, user.profile, raw.profile].filter(
    (item) => item && typeof item === "object",
  );
  const keys = [
    "userId",
    "user_id",
    "publicUserId",
    "externalUserId",
    "externalId",
  ];
  for (const src of sources) {
    for (const key of keys) {
      const s = String(src[key] ?? "").trim();
      if (s && /^(USR|ADM)-/i.test(s)) return s;
    }
    const idValue = String(src.id ?? "").trim();
    if (/^(USR|ADM)-/i.test(idValue)) return idValue;
  }
  return "";
}

export function resolveAdminContactHistoryUserId(user) {
  if (!user || typeof user !== "object") return "";
  const external = extractAdminUserExternalId(user);
  if (external) return external;
  const raw = user._raw && typeof user._raw === "object" ? user._raw : user;
  return String(user.userId ?? user.user_id ?? raw.userId ?? user.id ?? raw.id ?? "").trim();
}

function isExternalAdminUserId(value) {
  return /^(USR|ADM)-/i.test(String(value ?? "").trim());
}

async function resolveContactHistoryLookupId(user, seedId) {
  const fromUser = user ? resolveAdminContactHistoryUserId(user) : "";
  const initial = String(fromUser || seedId || "").trim();
  if (!initial) return "";
  if (isExternalAdminUserId(initial)) return initial;

  try {
    const detail = await adminDashboardApi.getAdminUser(initial);
    const fromDetail = extractAdminUserExternalId(detail);
    if (fromDetail) return fromDetail;
    const nested = detail?.user && typeof detail.user === "object" ? detail.user : null;
    const nestedId = String(
      detail?.userId ?? nested?.userId ?? detail?.id ?? nested?.id ?? "",
    ).trim();
    if (isExternalAdminUserId(nestedId)) return nestedId;
  } catch {
    /* fall back to seed id */
  }
  return initial;
}

export function normalizeContactHistoryRows(body) {
  if (body == null) return [];
  if (Array.isArray(body)) return body;
  if (typeof body !== "object") return [];

  const nested = body.data && typeof body.data === "object" ? body.data : null;
  const candidates = [
    body.content,
    body.items,
    body.records,
    body.history,
    body.results,
    body.rows,
    nested,
    nested?.content,
    nested?.items,
    nested?.records,
    nested?.history,
    nested?.results,
    nested?.rows,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  if (Array.isArray(body.data)) return body.data;
  return [];
}

function formatHistoryTime(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return s;
    }
  }
  return s;
}

function pickField(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    const s = String(v ?? "").trim();
    if (s && s !== "null" && s !== "undefined") return s;
  }
  return "—";
}

function formatChangedBy(raw) {
  if (raw == null) return "—";
  if (typeof raw === "string") {
    const s = raw.trim();
    return s || "—";
  }
  if (Array.isArray(raw)) {
    const parts = raw
      .map((item) => formatChangedBy(item))
      .filter((item) => item !== "—");
    return parts.length ? parts.join(", ") : "—";
  }
  if (typeof raw === "object") {
    return pickField(raw, ["userId", "id", "name", "email", "displayName"]);
  }
  const s = String(raw).trim();
  return s || "—";
}

function contactHistorySortKey(row) {
  const raw = row?.changedAt ?? row?.changed_at ?? row?.timestamp ?? row?.createdAt;
  const ms = Date.parse(String(raw ?? ""));
  return Number.isFinite(ms) ? ms : 0;
}

function contactFieldChanged(before, after) {
  return before !== "—" && after !== "—" && before !== after;
}

/**
 * Admin timeline for prior email/phone values.
 * @param {{ user?: object, userId?: string, userLabel?: string, onClose: () => void }} props
 */
export default function AdminContactHistoryPanel({
  user,
  userId,
  userLabel,
  onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [resolvedLookupId, setResolvedLookupId] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setRows([]);
    setResolvedLookupId("");
    void (async () => {
      const lookupId = await resolveContactHistoryLookupId(user, userId);
      if (cancelled) return;
      setResolvedLookupId(lookupId);
      if (!lookupId) {
        setLoading(false);
        setError("User id is missing for contact history lookup.");
        return;
      }
      try {
        const raw = await adminDashboardApi.getUserContactHistory(lookupId);
        if (cancelled) return;
        const list = normalizeContactHistoryRows(raw);
        list.sort((a, b) => contactHistorySortKey(b) - contactHistorySortKey(a));
        setRows(list);
      } catch (e) {
        if (cancelled) return;
        const st = Number(e?.status) || 0;
        if (st === 404 || st === 405) {
          setError("Contact history is not available on this server yet.");
        } else {
          setError(e?.message || "Could not load contact history.");
        }
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, userId]);

  return (
    <div
      className="kyc-mod-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="kyc-mod-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Previous contacts"
        style={{ maxWidth: 560 }}
      >
        <h4>Previous contacts</h4>
        <p className="kyc-mod-muted">
          {userLabel ? `${userLabel} · ` : ""}
          <span className="kyc-mod-mono">
            {resolvedLookupId || resolveAdminContactHistoryUserId(user) || userId}
          </span>
        </p>

        {loading ? (
          <p className="kyc-mod-muted" role="status">
            Loading contact history…
          </p>
        ) : null}

        {!loading && error ? (
          <p className="kyc-mod-muted" style={{ color: "#b91c1c" }} role="alert">
            {error}
          </p>
        ) : null}

        {!loading && !error && rows.length === 0 ? (
          <p className="kyc-mod-muted">No previous email or phone changes recorded.</p>
        ) : null}

        {!loading && !error && rows.length > 0 ? (
          <ul
            style={{
              listStyle: "none",
              margin: "12px 0 0",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {rows.map((row, i) => {
              const key = String(row?.id ?? row?.changedAt ?? i);
              const oldEmail = pickField(row, [
                "oldEmail",
                "old_email",
                "previousEmail",
                "emailBefore",
              ]);
              const newEmail = pickField(row, [
                "newEmail",
                "new_email",
                "emailAfter",
              ]);
              const oldPhone = pickField(row, [
                "oldPhone",
                "old_phone",
                "previousPhone",
                "phoneBefore",
              ]);
              const newPhone = pickField(row, [
                "newPhone",
                "new_phone",
                "phoneAfter",
              ]);
              const changedAt = formatHistoryTime(
                row?.changedAt ?? row?.changed_at ?? row?.timestamp ?? row?.createdAt,
              );
              const changedBy = formatChangedBy(
                row?.changedBy ?? row?.changed_by ?? row?.actor ?? row?.source,
              );
              const emailChanged = contactFieldChanged(oldEmail, newEmail);
              const phoneChanged = contactFieldChanged(oldPhone, newPhone);
              return (
                <li
                  key={key}
                  style={{
                    border: "1px solid rgba(148,163,184,0.35)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "rgba(248,250,252,0.6)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    {changedAt}
                    {changedBy !== "—" ? (
                      <span style={{ fontWeight: 600, color: "#64748b" }}>
                        {" "}
                        · {changedBy}
                      </span>
                    ) : null}
                  </div>
                  {emailChanged ? (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>
                      <strong>Email:</strong> {oldEmail} → {newEmail}
                    </div>
                  ) : null}
                  {phoneChanged ? (
                    <div style={{ fontSize: 13 }}>
                      <strong>Phone:</strong> {oldPhone} → {newPhone}
                    </div>
                  ) : null}
                  {!emailChanged && !phoneChanged ? (
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                      No field change recorded for this entry.
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="kyc-mod-modal-actions">
          <button type="button" className="users-page-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
