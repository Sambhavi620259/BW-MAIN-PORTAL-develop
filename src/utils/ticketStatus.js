const CANONICAL = /** @type {const} */ ({
  OPEN: "OPEN",
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
});

function norm(raw) {
  return String(raw ?? "").trim().toUpperCase();
}

/**
 * Normalize any backend/UI variant into canonical status:
 * `OPEN` | `PENDING` | `RESOLVED`
 *
 * Accepts: Open/open/OPEN, Pending/pending/PENDING, Resolved/resolved/RESOLVED, Closed/CLOSED.
 */
export function normalizeTicketStatus(raw) {
  const v = norm(raw);
  if (!v) return CANONICAL.OPEN;

  if (v === "OPEN" || v === "NEW") return CANONICAL.OPEN;
  if (v === "PENDING" || v === "IN_PROGRESS" || v === "INPROGRESS") return CANONICAL.PENDING;
  if (v === "RESOLVED" || v === "CLOSED" || v === "DONE") return CANONICAL.RESOLVED;

  return CANONICAL.OPEN;
}

export function getTicketStatusLabel(status) {
  const s = normalizeTicketStatus(status);
  if (s === CANONICAL.RESOLVED) return "Resolved";
  if (s === CANONICAL.PENDING) return "Pending";
  return "Open";
}

/**
 * Returns a compact tone token for consistent pills/badges.
 * - open: blue
 * - pending: amber
 * - resolved: green
 */
export function getTicketStatusTone(status) {
  const s = normalizeTicketStatus(status);
  if (s === CANONICAL.RESOLVED) return "success";
  if (s === CANONICAL.PENDING) return "warning";
  return "info";
}

export function getTicketStatusPillStyle(status) {
  const tone = getTicketStatusTone(status);
  if (tone === "success") {
    return { background: "rgba(22, 163, 74, 0.12)", color: "#14532d", border: "1px solid rgba(22, 163, 74, 0.25)", boxShadow: "0 2px 8px rgba(22, 163, 74, 0.1)" };
  }
  if (tone === "warning") {
    return { background: "rgba(234, 179, 8, 0.12)", color: "#713f12", border: "1px solid rgba(234, 179, 8, 0.3)", boxShadow: "0 2px 8px rgba(234, 179, 8, 0.1)" };
  }
  return { background: "rgba(37, 99, 235, 0.12)", color: "#1e3a8a", border: "1px solid rgba(37, 99, 235, 0.25)", boxShadow: "0 2px 8px rgba(37, 99, 235, 0.1)" };
}

