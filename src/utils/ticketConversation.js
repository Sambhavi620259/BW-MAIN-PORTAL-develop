function safeStr(v) {
  const s = String(v ?? "").trim();
  return s && s !== "null" ? s : "";
}

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTicketContainer(raw) {
  if (!raw) return { ticket: null, container: null };
  if (typeof raw !== "object") return { ticket: null, container: null };

  // Common nesting patterns
  const data = raw?.data && typeof raw.data === "object" ? raw.data : null;
  const ticket =
    raw?.ticket && typeof raw.ticket === "object"
      ? raw.ticket
      : data?.ticket && typeof data.ticket === "object"
        ? data.ticket
        : raw;

  return { ticket, container: raw };
}

function pickFirstArray(...candidates) {
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

export function normalizeTicketStatus(status) {
  const s = safeStr(status).toUpperCase();
  if (s === "RESOLVED" || s === "CLOSED") return "RESOLVED";
  if (s === "PENDING" || s === "IN_PROGRESS") return "PENDING";
  if (s === "OPEN" || s === "NEW") return "OPEN";
  return s || "OPEN";
}

/** Uppercase trimmed string for role matching; non-scalars → "". */
function roleStr(v) {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s ? s.toUpperCase() : "";
}

function isAdminRoleToken(token) {
  const u = roleStr(token);
  if (!u) return false;
  if (u === "ADMIN" || u === "SUPPORT" || u === "ROLE_ADMIN" || u === "ROLE_SUPPORT") return true;
  if (u.includes("ROLE_ADMIN") || u.includes("ADMIN")) return true;
  if (u === "STAFF" || u === "AGENT" || u === "MODERATOR") return true;
  return false;
}

/**
 * Collect string tokens from all common backend sender / role fields (flat + nested).
 */
function collectSenderRoleTokens(m) {
  if (!m || typeof m !== "object") return [];
  const out = [];
  const push = (v) => {
    if (v == null) return;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const s = roleStr(v);
      if (s) out.push(s);
    }
  };
  push(m.senderType);
  push(m.senderRole);
  push(m.role);
  push(m.authorRole);
  push(m.userRole);
  push(m.type);
  push(m.authorType);
  push(m.fromRole);
  if (typeof m.sender === "string") push(m.sender);
  if (typeof m.admin === "string" || typeof m.admin === "number") push(m.admin);
  if (m.sender && typeof m.sender === "object") {
    push(m.sender.role);
    push(m.sender.userRole);
    push(m.sender.type);
    push(m.sender.senderType);
  }
  if (m.user && typeof m.user === "object") {
    push(m.user.role);
    push(m.user.userRole);
  }
  if (m.author && typeof m.author === "object") {
    push(m.author.role);
    push(m.author.type);
  }
  return out;
}

/**
 * Canonical sender classification for ticket thread rows (polling, merge, relogin-safe).
 * Defaults to end-user when no admin signal is present — never inferred from sort order.
 *
 * @param {object} message
 * @param {{ silent?: boolean }} [_opts] — reserved for callers; unused (bulk-safe by default).
 * @returns {{ isAdminMessage: boolean, senderLabel: "Admin" | "User" }}
 */
export function normalizeMessageSender(message, _opts = {}) {
  const m = !message || typeof message !== "object" ? {} : message;

  if (m.fromUser === true) {
    return { isAdminMessage: false, senderLabel: /** @type {const} */ ("User") };
  }

  if (m.fromAdmin === true || m.isAdmin === true) {
    return { isAdminMessage: true, senderLabel: /** @type {const} */ ("Admin") };
  }

  if (m.admin === true) {
    return { isAdminMessage: true, senderLabel: /** @type {const} */ ("Admin") };
  }

  const tokens = collectSenderRoleTokens(m);
  for (const t of tokens) {
    if (isAdminRoleToken(t)) {
      return { isAdminMessage: true, senderLabel: /** @type {const} */ ("Admin") };
    }
  }

  return { isAdminMessage: false, senderLabel: /** @type {const} */ ("User") };
}

/**
 * normalizeTicketResponse
 * Unwraps backend shapes and returns a stable shape:
 *   { ticket, threadSource }
 *
 * threadSource is a ticket-like object containing:
 *   - messages: [ ... ] where each entry is raw backend message/reply
 * plus enough ticket metadata for composing the "original ticket message" as first item.
 */
export function normalizeTicketResponse(raw) {
  const { ticket, container } = normalizeTicketContainer(raw);
  const t = ticket && typeof ticket === "object" ? ticket : null;
  const c = container && typeof container === "object" ? container : null;

  const nestedData = c?.data && typeof c.data === "object" ? c.data : null;

  const replies = pickFirstArray(
    t?.messages,
    t?.replies,
    t?.conversation,
    t?.thread,
    t?.chat,
    t?.ticketReplies,
    c?.ticketReplies,
    c?.messages,
    c?.replies,
    nestedData?.replies,
    nestedData?.messages,
    nestedData?.ticketReplies,
    nestedData?.comments,
    c?.comments,
  );

  const ticketId = safeStr(t?.id ?? t?.ticketId ?? c?.id ?? c?.ticketId);
  const createdAt = t?.createdAt ?? t?.createdOn ?? t?.date ?? c?.createdAt ?? null;
  const originalText = safeStr(t?.description ?? t?.message ?? t?.body ?? t?.content);

  const originalMessage =
    originalText
      ? [
          {
            id: ticketId ? `ticket-${ticketId}` : "ticket-original",
            senderType: "USER",
            message: originalText,
            text: originalText,
            body: originalText,
            createdAt,
          },
        ]
      : [];

  const threadSource = {
    ...(t || {}),
    id: (t?.id ?? t?.ticketId ?? ticketId) || undefined,
    status: t?.status ?? c?.status ?? nestedData?.status ?? "OPEN",
    messages: [...originalMessage, ...replies],
  };

  return { ticket: t || (typeof raw === "object" ? raw : null), threadSource };
}

export function normalizeTicketThread(ticket) {
  const raw =
    ticket?.messages ||
    ticket?.replies ||
    ticket?.conversation ||
    ticket?.thread ||
    ticket?.chat ||
    ticket?.ticketReplies ||
    ticket?.comments ||
    [];
  const list = Array.isArray(raw) ? raw : [];

  return list
    .map((m, idx) => {
      const text = safeStr(
        m?.message ?? m?.text ?? m?.body ?? m?.content ?? m?.messageText ?? m?.html,
      );
      if (!text) return null;

      const { isAdminMessage } = normalizeMessageSender(m, { silent: true });
      const senderType = isAdminMessage ? "ADMIN" : "USER";

      const createdAtRaw =
        m?.createdAt ?? m?.sentAt ?? m?.time ?? m?.timestamp ?? m?.date ?? null;
      const createdAtMs = toEpochMs(createdAtRaw);
      const createdAtIso = createdAtMs ? new Date(createdAtMs).toISOString() : null;

      const id =
        safeStr(m?.id ?? m?.messageId ?? m?.replyId) ||
        (createdAtIso ? `${senderType}-${createdAtIso}-${idx}` : `${senderType}-${idx}`);

      return {
        id,
        senderType,
        text,
        createdAtMs: createdAtMs ?? 0,
        createdAtIso,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
}

function threadRowSenderType(m) {
  if (m?.senderType === "ADMIN" || m?.senderType === "USER") return m.senderType;
  return normalizeMessageSender(m, { silent: true }).isAdminMessage ? "ADMIN" : "USER";
}

function fallbackKey(m) {
  const at = m?.createdAtIso || String(m?.createdAtMs || "");
  return `${threadRowSenderType(m)}|${at}|${safeStr(m?.text).slice(0, 160)}`;
}

export function mergeMessages(prev, next, _meta = {}) {
  const a = Array.isArray(prev) ? prev : [];
  const b = Array.isArray(next) ? next : [];
  if (!a.length) {
    return b;
  }
  if (!b.length) {
    return a;
  }

  const map = new Map();
  for (const m of a) {
    const key = safeStr(m?.id) || fallbackKey(m);
    map.set(key, m);
  }
  for (const m of b) {
    const key = safeStr(m?.id) || fallbackKey(m);
    map.set(key, m);
  }
  const merged = Array.from(map.values());
  merged.sort((x, y) => (x?.createdAtMs || 0) - (y?.createdAtMs || 0));
  return merged;
}

export function isNearBottom(el, thresholdPx = 120) {
  if (!el) return true;
  const diff = el.scrollHeight - el.scrollTop - el.clientHeight;
  return diff <= thresholdPx;
}

