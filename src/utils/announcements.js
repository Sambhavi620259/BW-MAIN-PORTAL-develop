import { extractApiArrayAndMeta } from "./apiEnvelope";
import { resolveMediaUrl } from "./mediaUrl";

function safeStr(v) {
  return String(v ?? "").trim();
}

function toBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || String(v).toLowerCase() === "true") return true;
  if (v === 0 || v === "0" || String(v).toLowerCase() === "false") return false;
  return fallback;
}

/** Map UI fields to backend announcement write body (`message` is required on create). */
export function toAnnouncementApiPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return {};
  const out = {};
  if (payload.title !== undefined) {
    out.title = safeStr(payload.title);
  }
  if (payload.message !== undefined || payload.body !== undefined) {
    out.message = safeStr(payload.message ?? payload.body);
  }
  if (payload.icon !== undefined) {
    out.icon = safeStr(payload.icon) || "📣";
  }
  if (payload.published !== undefined) {
    out.published = Boolean(payload.published);
  }
  return out;
}

/**
 * Normalize a single announcement row from admin or user APIs.
 */
export function normalizeAnnouncement(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.announcementId;
  if (id === undefined || id === null || safeStr(id) === "") return null;

  const title = safeStr(raw.title ?? raw.headline ?? raw.name) || "Update";
  const body = safeStr(raw.body ?? raw.message ?? raw.description ?? raw.text);
  const icon = safeStr(raw.icon ?? raw.emoji) || "📣";
  const bannerRaw = safeStr(
    raw.bannerUrl ?? raw.banner ?? raw.coverUrl ?? raw.imageUrl ?? raw.cover,
  );
  const published = toBool(
    raw.published ?? raw.isPublished ?? raw.active ?? raw.enabled,
    true,
  );
  const createdAt = raw.createdAt ?? raw.publishedAt ?? raw.updatedAt ?? null;

  return {
    id: String(id),
    title,
    body,
    icon,
    bannerUrl: bannerRaw ? resolveMediaUrl(bannerRaw) : "",
    published,
    createdAt,
    _raw: raw,
  };
}

export function normalizeAnnouncementList(body) {
  const { items } = extractApiArrayAndMeta(body);
  return items.map(normalizeAnnouncement).filter(Boolean);
}

/** Compact card for user dashboard "What's New" list. */
export function announcementWhatsNewItem(row) {
  if (!row) return null;
  const text = row.body ? `${row.title}: ${row.body}` : row.title;
  return {
    id: row.id,
    icon: row.icon || "📣",
    text,
    bannerUrl: row.bannerUrl || "",
    title: row.title,
  };
}
