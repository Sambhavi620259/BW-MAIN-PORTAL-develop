/**
 * Normalizes GET /notifications/my paginated and array shapes for UI lists.
 * Mutations (mark read, read-all) are centralized in `notificationsBackend` (PUT).
 */
export function extractNotificationList(page) {
  if (page == null) return [];
  if (Array.isArray(page)) return page;
  if (Array.isArray(page.content)) return page.content;
  if (Array.isArray(page.items)) return page.items;
  if (Array.isArray(page.data)) return page.data;
  if (Array.isArray(page.records)) return page.records;
  return [];
}

export function resolveNotificationNav(raw) {
  if (!raw || typeof raw !== "object") return null;
  const candidates = [
    raw.link,
    raw.actionUrl,
    raw.deepLink,
    raw.route,
    raw.targetUrl,
    raw.url,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s && s !== "null") return s;
  }
  return null;
}

export function mapNotificationRows(page) {
  const content = extractNotificationList(page);
  return content.map((n) => ({
    id: n.id,
    text: n.title || n.message || n.body || n.text || "Notification",
    time: n.createdAt
      ? new Date(n.createdAt).toLocaleString()
      : n.timestamp
        ? new Date(n.timestamp).toLocaleString()
        : "recent",
    read: Boolean(n.read ?? n.isRead ?? n.readNotification ?? n.readAt),
    navigateTo: resolveNotificationNav(n),
    raw: n,
  }));
}

export function countUnreadInNotificationPage(page) {
  return mapNotificationRows(page).filter((r) => !r.read).length;
}

/** Normalize GET /notifications/unread-count response shapes. */
export function parseUnreadCountPayload(res) {
  if (res == null) return null;
  if (typeof res === "number" && Number.isFinite(res)) return Math.max(0, res);
  if (typeof res === "string" && /^\d+$/.test(res.trim())) return Math.max(0, Number(res.trim()));
  if (typeof res === "object") {
    const raw =
      res.unreadCount ??
      res.unread_count ??
      res.count ??
      res.totalUnread ??
      res.total ??
      res.data;
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, raw);
    if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return Math.max(0, Number(raw.trim()));
    if (raw && typeof raw === "object") {
      const inner = raw.unreadCount ?? raw.count;
      if (typeof inner === "number" && Number.isFinite(inner)) return Math.max(0, inner);
    }
  }
  return null;
}
