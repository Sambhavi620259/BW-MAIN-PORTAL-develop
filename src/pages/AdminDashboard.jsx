import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBrand } from "../context/BrandContext";
import { getInitials, useAuth } from "../context/AuthContext";
import { useNotificationInbox } from "../context/NotificationInboxContext";
import { adminDashboardApi } from "../services/adminDashboardApi";
import { extractProfilePhotoFromPayload, resolveProfilePhotoUrl } from "../utils/mediaUrl";
import { invalidateDashboardData } from "../services/dashboardInvalidate";
import { showError, showSuccess } from "../services/toast";
import {
  getTicketStatusLabel,
  getTicketStatusPillStyle,
  normalizeTicketStatus,
} from "../utils/ticketStatus";
import TicketConversation from "../components/TicketConversation";
import AdminKycDocPreviews from "../components/AdminKycDocPreviews";
import AdminContactHistoryPanel, {
  extractAdminUserExternalId,
  resolveAdminContactHistoryUserId,
} from "../components/AdminContactHistoryPanel";
import AdminAppsSection from "../components/AdminAppsSection";
import AdminAnnouncements from "../components/AdminAnnouncements";
import AdminInviteModal from "../components/AdminInviteModal";
import AdminRoleChangeModal from "../components/AdminRoleChangeModal";
import AdminUserRoleBadge from "../components/AdminUserRoleBadge";
import { canAccessAdminPanel, canActorManageUserRole, canInviteAdmins, extractRowPanelRole } from "../utils/adminRoles";
import {
  mergeMessages,
  normalizeTicketResponse,
  normalizeTicketThread,
} from "../utils/ticketConversation";
import {
  KYC_CANONICAL,
  canonicalizeKycStatus,
  kycCanonicalLabel,
  kycCanonicalSlug,
  kycStatsFromNormalizedRows,
  kycNormalizedRowToDetailPatch,
  mergeAdminKycDetailRow,
  normalizeAdminKycRow,
  resolveKycApiPathId,
  sanitizeKycRejectReasonInput,
} from "../utils/kycAdmin";
import "./AdminDashboard.css";

const ADMIN_SIDEBAR_ITEMS = [
  { label: "Dashboard", icon: "dashboard", key: "dashboard", path: "/admin" },
  { label: "Users", icon: "users", key: "users", path: "/admin/users" },
  {
    label: "KYC Verification",
    icon: "kyc",
    key: "kyc",
    path: "/admin/kyc",
  },
  { label: "Apps", icon: "apps", key: "apps", path: "/admin/apps" },
  { label: "Billing", icon: "billing", key: "billing", path: "/admin/billing" },
  {
    label: "Announcements",
    icon: "megaphone",
    key: "announcements",
    path: "/admin/announcements",
  },
  { label: "Tickets", icon: "tickets", key: "tickets", path: "/admin/tickets" },
  {
    label: "Notifications",
    icon: "notifications",
    key: "notifications",
    path: "/admin/notifications",
  },
  {
    label: "Settings",
    icon: "settings",
    key: "settings",
    path: "/admin/settings",
  },
];

const Y_AXIS_LABELS = ["10k", "5k"];
const X_AXIS_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];

const DASHBOARD_FETCH_MAX_ATTEMPTS = 3;
/** Dashboard home / analytics: background refresh for summary + lists (not user growth). */
const DASHBOARD_POLL_MS = 45_000;
const KYC_ADMIN_POLL_MS = 60_000;
const ACTION_MAX_ATTEMPTS = 2;
const DASHBOARD_PANEL_MAX_ITEMS = 8;
const KYC_ADMIN_PAGE_SIZE = 8;

/** Synthetic IDs from `normalizeAdminKycRow` when backend omits an id — moderation actions stay disabled. */
function adminKycRowHasActionableId(row) {
  if (resolveKycApiPathId(row)) return true;
  const id = String(row?.id ?? "").trim();
  if (!id) return false;
  return !/^kyc_\d+$/.test(id);
}

const ADMIN_STATS_TEMPLATE = [
  {
    label: "Total Users",
    value: "0",
    delta: "",
    tone: "cool",
    icon: "users",
    points:
      "0,18 9,16 18,17 27,15 36,14 45,13 54,12 64,12 74,11 84,11 94,10 100,10",
  },
  {
    label: "Active Users",
    value: "0",
    delta: "",
    tone: "cool",
    icon: "activity",
    points:
      "0,19 9,18 18,17 27,16 36,15 45,14 54,13 64,12 74,12 84,11 94,11 100,10",
  },
  {
    label: "Total Apps",
    value: "0",
    delta: "",
    tone: "cool",
    icon: "apps",
    points:
      "0,17 9,16 18,16 27,15 36,14 45,14 54,13 64,12 74,12 84,11 94,11 100,10",
  },
  {
    label: "Revenue",
    value: "—",
    delta: "",
    tone: "mint",
    icon: "billing",
    points:
      "0,20 9,19 18,18 27,18 36,17 45,16 54,16 64,15 74,14 84,14 94,13 100,13",
  },
  {
    label: "Open Tickets",
    value: "0",
    delta: "",
    tone: "cool",
    icon: "tickets",
    points:
      "0,18 9,17 18,16 27,15 36,15 45,14 54,13 64,13 74,12 84,12 94,11 100,11",
  },
];

function toStringSafe(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function toFiniteNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDateMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatLastUpdated(lastUpdatedAtMs) {
  if (!Number.isFinite(lastUpdatedAtMs)) return "Last updated: —";
  const diffMs = Date.now() - lastUpdatedAtMs;
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return `Last updated: ${new Date(lastUpdatedAtMs).toLocaleString()}`;
  }
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Last updated: just now";
  if (mins < 60) return `Last updated: ${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)
    return `Last updated: ${hours} hr${hours === 1 ? "" : "s"} ago`;
  return `Last updated: ${new Date(lastUpdatedAtMs).toLocaleString()}`;
}

function isServerUnavailableError(err) {
  const msg = toStringSafe(err?.message, "").toLowerCase();
  return (
    !navigator.onLine ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch") ||
    msg.includes("timeout") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("service unavailable")
  );
}

async function withRetry(fn, { maxAttempts, label }) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1 && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          `[AdminDashboard] retrying ${label} (attempt ${attempt}/${maxAttempts})`,
        );
      }
      return await fn({ attempt });
    } catch (err) {
      lastErr = err;
      // Never retry auth / RBAC failures; avoid infinite loops for ROLE_USER on admin APIs.
      if (err?.status === 401 || err?.status === 403) {
        break;
      }
      if (attempt >= maxAttempts) break;
      const delayMs = 400 * attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function normalizeGrowthPoint(item, index) {
  if (typeof item === "number") {
    return { name: String(index), users: toFiniteNumber(item, 0) };
  }
  if (!item || typeof item !== "object") return null;
  const date = toStringSafe(
    item?.month ?? item?.date ?? item?.name ?? item?.label,
    "",
  ).trim();
  const users = toFiniteNumber(
    item?.users ?? item?.count ?? item?.totalUsers ?? item?.value,
    0,
  );
  const name = date || `M${index + 1}`;
  return { name, users };
}

function formatGrowthAxisLabel(value) {
  const n = toFiniteNumber(value, 0);
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
}

/** SVG geometry for the dashboard user growth panel (custom SVG, not Recharts). */
function buildGrowthChartModel(chartData) {
  const rows = Array.isArray(chartData) ? chartData : [];
  if (!rows.length) {
    return {
      hasGrowthData: false,
      coords: [],
      polylinePoints: "",
      areaPath: "",
      yAxisLabels: ["0"],
      growthXLabels: X_AXIS_LABELS,
    };
  }

  const growthValues = rows.map((item) => toFiniteNumber(item.users, 0));
  const maxGrowth = Math.max(...growthValues, 0) || 1;
  const count = growthValues.length;
  const divisor = Math.max(count - 1, 1);
  const coords = growthValues.map((value, index) => {
    const x = count === 1 ? 400 : 30 + (index * 760) / divisor;
    const y = 220 - (value / maxGrowth) * 165;
    return { x, y, value };
  });

  let polylinePoints = "";
  let areaPath = "";
  if (count === 1) {
    const { x, y } = coords[0];
    const barHalf = 28;
    polylinePoints = `${x - barHalf},${y} ${x + barHalf},${y}`;
    areaPath = `M ${x - barHalf} 220 L ${x - barHalf} ${y} L ${x + barHalf} ${y} L ${x + barHalf} 220 Z`;
  } else {
    polylinePoints = coords.map(({ x, y }) => `${x},${y}`).join(" ");
    const first = coords[0];
    const last = coords[count - 1];
    areaPath = `M ${polylinePoints} L ${last.x} 220 L ${first.x} 220 Z`;
  }

  return {
    hasGrowthData: true,
    coords,
    polylinePoints,
    areaPath,
    yAxisLabels: [
      formatGrowthAxisLabel(maxGrowth),
      formatGrowthAxisLabel(maxGrowth / 2),
      "0",
    ],
    growthXLabels: rows.map((item) => item.name),
  };
}

function firstNonEmptyActivityLabel(...candidates) {
  for (const c of candidates) {
    const s = toStringSafe(c, "").trim();
    if (s) return s;
  }
  return "";
}

function normalizeActivityEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const event = firstNonEmptyActivityLabel(
    entry.event,
    entry.title,
    entry.action,
    entry.description,
    entry.message,
    entry.type,
  );
  const meta = toStringSafe(entry?.meta, "").trim();
  const time = toStringSafe(
    entry?.time ?? entry?.createdAt ?? entry?.timestamp ?? entry?.at ?? "",
  ).trim();
  if (!event) return null;
  return { event, meta, time };
}

/** Admin user status PATCH wired via adminDashboardApi. */
const ADMIN_USER_STATUS_UPDATE_AVAILABLE = true;
/** Admin user view modal (read-only details + contact history). */

const UNNAMED_USER_LABEL = "Unnamed User";

/** Phone fields aligned with `normalizeProfilePayload` in AuthContext. */
function pickPhoneFromUserRecord(user) {
  if (!user || typeof user !== "object") return "";
  const nested = user.user && typeof user.user === "object" ? user.user : null;
  const profile =
    user.profile && typeof user.profile === "object" ? user.profile : null;
  const raw =
    user.phoneNumber ??
    user.phone ??
    user.mobile ??
    user.mobileNumber ??
    nested?.phoneNumber ??
    profile?.phoneNumber ??
    "";
  return String(raw || "").trim();
}

function pickOptionalTicketCount(user) {
  const raw =
    user?.openTicketsCount ??
    user?.ticketCount ??
    user?.supportTicketsCount ??
    user?.ticketsOpenCount ??
    null;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function pickKycPill(user) {
  const profile =
    user?.profile && typeof user.profile === "object" ? user.profile : null;
  const raw =
    user?.kycStatus ??
    profile?.kycStatus ??
    (user?.kyc && typeof user.kyc === "object" ? user.kyc.status : null) ??
    (typeof user?.kyc === "string" ? user.kyc : null) ??
    user?.verificationStatus ??
    "";
  const trimmed = String(raw || "").trim();
  const canon = canonicalizeKycStatus(
    !trimmed ||
      trimmed.toUpperCase() === "NULL" ||
      trimmed.toUpperCase() === "UNDEFINED"
      ? ""
      : trimmed,
  );
  const slug = kycCanonicalSlug(canon);
  return { key: slug, label: kycCanonicalLabel(canon), className: slug };
}

function resolveUserDisplayName(user) {
  if (!user || typeof user !== "object") return UNNAMED_USER_LABEL;
  const profile =
    user.profile && typeof user.profile === "object" ? user.profile : null;
  const nested = user.user && typeof user.user === "object" ? user.user : null;
  const partA = user.firstName != null ? String(user.firstName).trim() : "";
  const partB = user.lastName != null ? String(user.lastName).trim() : "";
  const fromParts = [partA, partB].filter(Boolean).join(" ").trim();
  const candidates = [
    user.name,
    user.fullName,
    user.username,
    user.displayName,
    fromParts,
    profile?.name,
    nested?.name,
  ];
  for (const c of candidates) {
    const t = String(c ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      !t ||
      t === "undefined" ||
      t === "null" ||
      /^undefined(\s+undefined)?$/i.test(t)
    ) {
      continue;
    }
    return t;
  }
  return UNNAMED_USER_LABEL;
}

function avatarInitialsFromDisplayName(displayName) {
  const d = String(displayName || "").trim();
  if (!d || d === UNNAMED_USER_LABEL) return "U";
  return getInitials(d);
}

function pickAccountStatusMeta(user) {
  if (!user || typeof user !== "object") {
    return { key: "UNKNOWN", label: "Unknown", pillClass: "unknown" };
  }
  const locked =
    user.locked === true ||
    user.isLocked === true ||
    user.accountLocked === true;
  if (locked)
    return { key: "SUSPENDED", label: "Suspended", pillClass: "suspended" };

  const sRaw = user.status ?? user.accountStatus;
  if (sRaw !== undefined && sRaw !== null && String(sRaw).trim()) {
    const u = String(sRaw).trim().toUpperCase();
    if (u === "ACTIVE" || u === "ENABLED" || u === "ACTIVATED")
      return { key: "ACTIVE", label: "Active", pillClass: "active" };
    if (u === "INACTIVE" || u === "DISABLED" || u === "DEACTIVATED")
      return { key: "INACTIVE", label: "Inactive", pillClass: "inactive" };
    if (u === "BLOCKED" || u === "BANNED")
      return { key: "BLOCKED", label: "Blocked", pillClass: "blocked" };
    if (u === "SUSPENDED")
      return { key: "SUSPENDED", label: "Suspended", pillClass: "suspended" };
    if (u === "PENDING")
      return { key: "PENDING", label: "Pending", pillClass: "pending" };
  }

  if (user.isActive === true)
    return { key: "ACTIVE", label: "Active", pillClass: "active" };
  if (user.isActive === false)
    return { key: "INACTIVE", label: "Inactive", pillClass: "inactive" };
  if (user.enabled === true)
    return { key: "ACTIVE", label: "Active", pillClass: "active" };
  if (user.enabled === false)
    return { key: "INACTIVE", label: "Inactive", pillClass: "inactive" };

  return { key: "UNKNOWN", label: "Unknown", pillClass: "unknown" };
}

/**
 * View Tickets search `q`: user id → email → display name.
 * Disable when nothing usable (including “Unnamed User” alone).
 */
function pickTicketsNavQueryParts(rawUser) {
  if (!rawUser || typeof rawUser !== "object") return { q: "", enabled: false };
  const id = String(rawUser.id ?? rawUser.userId ?? "").trim();
  const email = String(rawUser.email ?? rawUser.userEmail ?? "").trim();
  const resolved = resolveUserDisplayName(rawUser).trim();
  const name = resolved && resolved !== UNNAMED_USER_LABEL ? resolved : "";
  const q = id || email || name || "";
  const enabled = Boolean(id || email || name);
  return { q, enabled };
}

function formatJoinedDate(raw) {
  const s = toStringSafe(raw, "").trim();
  if (!s) return "—";
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    try {
      return new Date(ms).toLocaleDateString();
    } catch {
      return s;
    }
  }
  return s;
}

function normalizeAdminUserRow(user) {
  const externalUserId = extractAdminUserExternalId(user);
  const listId = toStringSafe(user?.id ?? user?.userId, "").trim();
  const id = listId || externalUserId || "";
  const displayName = resolveUserDisplayName(user);
  const email = toStringSafe(user?.email ?? user?.userEmail, "").trim();
  const joinedRaw =
    user?.joinedOn ?? user?.createdAt ?? user?.registeredAt ?? "";
  const joinedOnDisplay = formatJoinedDate(joinedRaw);
  const phoneRaw = pickPhoneFromUserRecord(user);
  const phone = phoneRaw || "—";
  const kycPill = pickKycPill(user);
  const statusMeta = pickAccountStatusMeta(user);
  const ticketCount = pickOptionalTicketCount(user);
  const ticketsNav = pickTicketsNavQueryParts(user);
  const panelRole = extractRowPanelRole(user);
  return {
    ...user,
    id:
      id ||
      email ||
      displayName ||
      crypto.randomUUID?.() ||
      `u_${Math.random()}`,
    userId: externalUserId || toStringSafe(user?.userId ?? user?.user_id, "").trim() || id,
    displayName,
    name: displayName,
    email: email || "—",
    phone,
    joinedOnDisplay,
    /** Same formatted value as `joinedOnDisplay` for table cells that expect `joinedOn`. */
    joinedOn: joinedOnDisplay,
    kycPill,
    statusMeta,
    /** Back-compat with dashboard search / CSV — same as account status label. */
    status: statusMeta.label,
    ticketCount,
    ticketsNav,
    panelRole,
    _raw: user,
  };
}

/** Backend-agnostic primary id for routing + merge (never use empty string as a Map key). */
function adminTicketPrimaryId(t) {
  if (!t || typeof t !== "object") return "";
  const z =
    t.id ?? t.ticketId ?? t.code ?? t.uuid ?? t.publicId ?? t.ticketNumber;
  if (z === 0 || z === false) return String(z);
  const s = String(z ?? "").trim();
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}

/** Stable dedupe key for admin ticket rows (matches merge + list identity). */
function adminTicketMergeKey(t) {
  const pid = adminTicketPrimaryId(t);
  if (pid) return pid;
  const sub = String(t?.subject ?? t?.issue ?? "")
    .trim()
    .slice(0, 80);
  const em = String(t?.userEmail ?? t?.email ?? "")
    .trim()
    .slice(0, 80);
  const cr = String(
    t?.createdAt ?? t?.createdOn ?? t?.date ?? t?.time ?? "",
  ).trim();
  return `~${sub}|${em}|${cr}`.replace(/\s+/g, " ");
}

function rawTicketCanonicalStatus(t) {
  return normalizeTicketStatus(
    t?.status ?? t?.ticketStatus ?? t?.state ?? t?.ticketState ?? "",
  );
}

function normalizeAdminPriorityLabel(raw) {
  const p = toStringSafe(raw, "Medium").trim();
  if (!p) return "Medium";
  const lower = p.toLowerCase();
  if (lower === "low" || lower === "l" || lower === "p4" || lower === "p3")
    return "Low";
  if (
    lower === "high" ||
    lower === "urgent" ||
    lower === "critical" ||
    lower === "p1" ||
    lower === "p0"
  )
    return "High";
  if (
    lower === "medium" ||
    lower === "normal" ||
    lower === "med" ||
    lower === "p2" ||
    lower === "moderate"
  )
    return "Medium";
  if (["Low", "Medium", "High"].includes(p)) return p;
  return "Medium";
}

function mergeAdminTicketPages(prevList, incoming) {
  const prev = Array.isArray(prevList) ? prevList : [];
  if (prev.length > 0 && incoming.length === 0) return prev;
  const map = new Map(prev.map((t) => [adminTicketMergeKey(t), t]));
  incoming.forEach((t) => {
    map.set(adminTicketMergeKey(t), t);
  });
  const out = Array.from(map.values());
  return out;
}

function normalizeTicket(ticket) {
  const primaryId = adminTicketPrimaryId(ticket);
  const nestedUser =
    ticket?.user && typeof ticket.user === "object" ? ticket.user : null;
  const subject = toStringSafe(
    ticket?.subject ?? ticket?.issue ?? "",
    "",
  ).trim();
  const id =
    primaryId ||
    subject ||
    (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
    `t_${Math.random()}`;
  const userName = toStringSafe(
    ticket?.userName ??
      ticket?.name ??
      nestedUser?.name ??
      nestedUser?.fullName ??
      nestedUser?.displayName ??
      "",
    "",
  ).trim();
  const userEmail = toStringSafe(
    ticket?.userEmail ??
      ticket?.email ??
      nestedUser?.email ??
      nestedUser?.userEmail ??
      "",
    "",
  ).trim();
  const userId = toStringSafe(
    ticket?.userId ??
      ticket?.user_id ??
      nestedUser?.id ??
      nestedUser?.userId ??
      nestedUser?.user_id ??
      ticket?.raisedBy ??
      ticket?.createdByUserId ??
      ticket?.createdBy ??
      "",
    "",
  ).trim();
  const priority = normalizeAdminPriorityLabel(ticket?.priority);
  const statusRaw = toStringSafe(
    ticket?.status ??
      ticket?.ticketStatus ??
      ticket?.state ??
      ticket?.ticketState,
    "OPEN",
  ).trim();
  const date = toStringSafe(
    ticket?.date ?? ticket?.createdAt ?? ticket?.time ?? "",
    "",
  ).trim();
  const description = toStringSafe(ticket?.description, "").trim();
  const conversation = Array.isArray(ticket?.conversation)
    ? ticket.conversation
    : [];
  const safeConversation = conversation
    .map((m, idx) => {
      const mid = toStringSafe(m?.id, "").trim() || `${id || "t"}_${idx}`;
      const text = toStringSafe(m?.text, "").trim();
      const time = toStringSafe(m?.time, "").trim();
      const sender = toStringSafe(m?.sender, "").trim();
      if (!text) return null;
      return { id: mid, text, time: time || "—", sender: sender || "user" };
    })
    .filter(Boolean);

  const status = normalizeTicketStatus(statusRaw);

  return {
    ...ticket,
    // IMPORTANT: keep stable ID so rows never "disappear" due to key drift across responses.
    id,
    subject: subject || "—",
    userName: userName || "—",
    userEmail: userEmail || "—",
    userId: userId || "",
    priority,
    status,
    date: date || "—",
    description: description || "—",
    conversation: safeConversation,
  };
}

function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  switch (name) {
    case "users":
      return (
        <svg {...common}>
          <path d="M16 21V19C16 17.34 14.66 16 13 16H7C5.34 16 4 17.34 4 19V21" />
          <circle cx="10" cy="8" r="3" />
          <path d="M20 21V19.5C20 18.18 19.16 16.99 18 16.57" />
          <path d="M15.5 5.3C16.78 5.63 17.72 6.79 17.72 8.15C17.72 9.51 16.78 10.67 15.5 11" />
        </svg>
      );
    case "apps":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="8" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
          <rect x="13" y="13" width="8" height="8" rx="2" />
        </svg>
      );
    case "billing":
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="3" />
          <path d="M2.5 10H21.5" />
          <path d="M7.5 15H10.5" />
        </svg>
      );
    case "tickets":
      return (
        <svg {...common}>
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19V9A2 2 0 0 0 19 13V17H6.5A2.5 2.5 0 0 1 4 14.5Z" />
          <path d="M13 9V9.01" />
          <path d="M13 12V12.01" />
          <path d="M13 15V15.01" />
        </svg>
      );
    case "analytics":
    case "activity":
      return (
        <svg {...common}>
          <path d="M3 3V21H21" />
          <path d="M7 15L11 11L14 14L20 8" />
        </svg>
      );
    case "notifications":
      return (
        <svg {...common}>
          <path d="M18 8A6 6 0 0 0 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" />
          <path d="M13.73 21A2 2 0 0 1 10.27 21" />
        </svg>
      );
    case "megaphone":
      return (
        <svg {...common}>
          <path d="M3 11v2" />
          <path d="M7 9v6" />
          <path d="M11 7.5v9" />
          <path d="M15 5v14l6-7-6-7z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15A1.65 1.65 0 0 0 19.73 16.82L19.79 16.88A2 2 0 1 1 16.96 19.71L16.9 19.65A1.65 1.65 0 0 0 15.08 19.32A1.65 1.65 0 0 0 14 20.85V21A2 2 0 1 1 10 21V20.91A1.65 1.65 0 0 0 8.92 19.37A1.65 1.65 0 0 0 7.1 19.7L7.04 19.76A2 2 0 1 1 4.21 16.93L4.27 16.87A1.65 1.65 0 0 0 4.6 15.05A1.65 1.65 0 0 0 3.07 14H3A2 2 0 1 1 3 10H3.09A1.65 1.65 0 0 0 4.63 8.92A1.65 1.65 0 0 0 4.3 7.1L4.24 7.04A2 2 0 1 1 7.07 4.21L7.13 4.27A1.65 1.65 0 0 0 8.95 4.6H9A1.65 1.65 0 0 0 10 3.06V3A2 2 0 1 1 14 3V3.09A1.65 1.65 0 0 0 15.08 4.63A1.65 1.65 0 0 0 16.9 4.3L16.96 4.24A2 2 0 1 1 19.79 7.07L19.73 7.13A1.65 1.65 0 0 0 19.4 8.95V9A1.65 1.65 0 0 0 20.94 10H21A2 2 0 1 1 21 14H20.91A1.65 1.65 0 0 0 19.37 15.08Z" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...common}>
          <path d="M3 13H11V3H3Z" />
          <path d="M13 21H21V11H13Z" />
          <path d="M13 3H21V9H13Z" />
          <path d="M3 15H11V21H3Z" />
        </svg>
      );
    case "kyc":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M8 9H16" />
          <path d="M8 13H13" />
          <path d="M16.5 16.5L18.2 18.2L21 15.4" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20L17 17" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

function TicketBadge({ type, value }) {
  if (type === "status") {
    const canonical = normalizeTicketStatus(value);
    const label = getTicketStatusLabel(canonical);
    const pill = getTicketStatusPillStyle(canonical);
    return (
      <span
        className={`ticket-badge ${type}`}
        style={{
          ...pill,
          padding: "6px 10px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: "0.3px",
        }}
      >
        {label}
      </span>
    );
  }
  const normalized = String(value || "").toLowerCase();
  return <span className={`ticket-badge ${type} ${normalized}`}>{value}</span>;
}

export default function AdminDashboard() {
  useEffect(() => {
    ticketsMountedRef.current = true;
    return () => {
      ticketsMountedRef.current = false;
    };
  }, []);

  const { brand, setBrand, resetBrand, defaultBrand } = useBrand();
  const { profile: user, logout, role } = useAuth();
  const authProfile = user;
  const rawPhoto = extractProfilePhotoFromPayload(user);
  const profilePhotoUrl = rawPhoto ? resolveProfilePhotoUrl(rawPhoto) : "";
  const navigate = useNavigate();
  const location = useLocation();

  const pathParts = location.pathname.split("/").filter(Boolean);
  const pageKey = pathParts[1] || "dashboard";
  const activeTicketIdFromRoute =
    pageKey === "tickets"
      ? pathParts[2]
        ? decodeURIComponent(pathParts[2])
        : null
      : null;

  // RBAC guard (backend is source of truth; UI must not spam retries for non-admin roles).
  useEffect(() => {
    const normalized = String(
      role || window.localStorage.getItem("ui-role") || "",
    ).toUpperCase();
    if (normalized && !canAccessAdminPanel(normalized)) {
      showError("Unauthorized: admin access required");
      navigate("/dashboard", {
        replace: true,
        state: { message: "Unauthorized: admin access required" },
      });
    }
  }, [role, navigate]);

  // ── Data layer ──────────────────────────────────────────────────────────────
  // NOTE: Admin dashboard must use real backend endpoints only. Legacy `useAdminDashboard`
  // (mock/synthetic sources) is intentionally not used here.
  const adminStats = [];
  const payments = [];
  // Legacy variable referenced by DEV logs; keep empty to avoid synthetic data.
  const tickets = [];
  const ticketsLoading = false;
  const sendTicketReply = async () => {};
  const userGrowth = [];

  const {
    notifications: inboxNotifications,
    unreadCount: inboxUnreadCount,
    loading: inboxNotifLoading,
    error: inboxNotifError,
    refresh: refreshInboxNotifications,
    markOneRead: inboxMarkOneRead,
    markAllRead: inboxMarkAllRead,
  } = useNotificationInbox();

  // ── Admin dashboard API integration (safe + non-breaking) ────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [apiUserGrowth, setApiUserGrowth] = useState([]);
  const [apiActivity, setApiActivity] = useState([]);
  const [apiRecentUsers, setApiRecentUsers] = useState([]);
  const [apiTicketsForAdminPages, setApiTicketsForAdminPages] = useState([]);
  /** Snapshot of list rows for merge (updated every render). */
  const apiTicketsForAdminPagesRef = useRef([]);
  const [apiTicketsForAdminPagesLoading, setApiTicketsForAdminPagesLoading] =
    useState(false);
  const ticketsFetchRef = useRef({ active: false, seq: 0 });
  const ticketsMountedRef = useRef(true);
  const ticketsHasLoadedRef = useRef(false);
  /** Dashboard / analytics home: visibility-aware poll (does not refetch user growth). */
  const dashboardPollMountedRef = useRef(true);
  const dashboardPollInFlightRef = useRef(false);
  const dashboardPollGenRef = useRef(0);
  const [apiKycRequests, setApiKycRequests] = useState([]);
  const [apiKycLoading, setApiKycLoading] = useState(false);
  const [kycLoadError, setKycLoadError] = useState(null);
  const [apiAdminUsers, setApiAdminUsers] = useState([]);
  const [apiAdminUsersLoading, setApiAdminUsersLoading] = useState(false);
  const [apiAdminUsersLoadError, setApiAdminUsersLoadError] = useState(null);
  const [adminUsersReloadSeq, setAdminUsersReloadSeq] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [resolvingTicketIds, setResolvingTicketIds] = useState(() => new Set());
  const DEV_BUILD_MARKER = "";
  const adminAuthToastShownRef = useRef(false);
  const kycListReloadGenRef = useRef(0);
  const kycListReloadInFlightRef = useRef(false);
  const kycDrawerFetchGenRef = useRef(0);
  // ── UI state (must be declared before effects that use it) ──────────────────
  const [ticketStatusFilter, setTicketStatusFilter] = useState("All");
  const showApiErrorToast = (fallbackMessage, err) => {
    // apiFetch handles 401 (session expiry) with a redirect/logout; avoid noisy toasts during that flow.
    if (err?.status === 401) return;
    if (isServerUnavailableError(err)) {
      showError("Server unavailable");
      return;
    }
    showError(fallbackMessage);
  };

  const bumpAdminUsersAfterKycModeration = useCallback(() => {
    setAdminUsersReloadSeq((s) => s + 1);
    void adminDashboardApi
      .getRecentUsers()
      .then((list) => {
        if (Array.isArray(list)) setApiRecentUsers(list);
      })
      .catch(() => {});
  }, []);

  const reloadKycList = useCallback(async () => {
    if (kycListReloadInFlightRef.current) return;
    kycListReloadInFlightRef.current = true;
    const gen = ++kycListReloadGenRef.current;
    setApiKycLoading(true);
    setKycLoadError(null);
    try {
      let list = [];
      try {
        const all = await adminDashboardApi.getKycAll();
        if (Array.isArray(all) && all.length) list = all;
      } catch {
        // GET /kyc/all may be absent in some deployments; fall back to pending queue.
      }
      if (!list.length) {
        const pending = await adminDashboardApi.getKycPending().catch(() => []);
        list = Array.isArray(pending) ? pending : [];
      }
      if (gen === kycListReloadGenRef.current) {
        setApiKycRequests(list);
        setLastUpdatedAt(Date.now());
      }
    } catch (err) {
      if (gen === kycListReloadGenRef.current) {
        setApiKycRequests([]);
        setKycLoadError(err?.message || "Could not load KYC queue");
        showApiErrorToast("Could not load KYC queue", err);
      }
    } finally {
      kycListReloadInFlightRef.current = false;
      if (gen === kycListReloadGenRef.current) {
        setApiKycLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [
          summaryRes,
          growthRes,
          activityRes,
          recentUsersRes,
          openTicketsRes,
        ] = await withRetry(
          async () =>
            await Promise.all([
              adminDashboardApi.getSummary(),
              adminDashboardApi.getUserGrowth(),
              adminDashboardApi.getActivity(),
              adminDashboardApi.getRecentUsers(),
              adminDashboardApi.getOpenTickets(),
            ]),
          {
            maxAttempts: DASHBOARD_FETCH_MAX_ATTEMPTS,
            label: "dashboard fetch",
          },
        );

        if (!mounted) return;
        setSummary(summaryRes ?? null);
        setApiUserGrowth(Array.isArray(growthRes) ? growthRes : []);
        setApiActivity(Array.isArray(activityRes) ? activityRes : []);
        setApiRecentUsers(Array.isArray(recentUsersRes) ? recentUsersRes : []);
        // SINGLE source of truth:
        // Merge Open tickets into `apiTicketsForAdminPages` so both widget + table derive from one array.
        setApiTicketsForAdminPages((prev) => {
          const incoming = Array.isArray(openTicketsRes) ? openTicketsRes : [];
          if (!incoming.length) return Array.isArray(prev) ? prev : [];
          const map = new Map(
            (Array.isArray(prev) ? prev : []).map((t) => [
              adminTicketMergeKey(t),
              t,
            ]),
          );
          incoming.forEach((t) => {
            map.set(adminTicketMergeKey(t), t);
          });
          return Array.from(map.values());
        });
        setLastUpdatedAt(Date.now());
      } catch (err) {
        if (!mounted) return;
        const status = err?.status;
        if (
          (status === 401 || status === 403) &&
          !adminAuthToastShownRef.current
        ) {
          adminAuthToastShownRef.current = true;
          showError("Admin access not enabled for this account");
        } else {
          showApiErrorToast("Failed to load dashboard data", err);
        }
        setError(err?.message || "Failed to load dashboard data");
        // Preserve layout: keep safe empty values (don't early-return error UI).
        setSummary(null);
        setApiUserGrowth([]);
        setApiActivity([]);
        setApiRecentUsers([]);
        // Do NOT clear tickets here; avoid overwriting a previously successful tickets state.
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // ── Dashboard / analytics: lightweight background refresh (no growth refetch) ─
  useEffect(() => {
    if (pageKey !== "dashboard" && pageKey !== "analytics") return undefined;
    dashboardPollMountedRef.current = true;
    let intervalId = null;
    const clear = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const refresh = async () => {
      if (
        !dashboardPollMountedRef.current ||
        document.visibilityState !== "visible"
      )
        return;
      if (dashboardPollInFlightRef.current) return;
      const genSnapshot = dashboardPollGenRef.current;
      dashboardPollInFlightRef.current = true;
      try {
        const [summaryRes, activityRes, recentUsersRes, openTicketsRes] =
          await Promise.all([
            adminDashboardApi.getSummary(),
            adminDashboardApi.getActivity(),
            adminDashboardApi.getRecentUsers(),
            adminDashboardApi.getOpenTickets(),
          ]);
        if (
          !dashboardPollMountedRef.current ||
          genSnapshot !== dashboardPollGenRef.current
        )
          return;
        setSummary(summaryRes ?? null);
        setApiActivity(Array.isArray(activityRes) ? activityRes : []);
        setApiRecentUsers(Array.isArray(recentUsersRes) ? recentUsersRes : []);
        setApiTicketsForAdminPages((prev) => {
          const incoming = Array.isArray(openTicketsRes) ? openTicketsRes : [];
          if (!incoming.length) return Array.isArray(prev) ? prev : [];
          const map = new Map(
            (Array.isArray(prev) ? prev : []).map((t) => [
              adminTicketMergeKey(t),
              t,
            ]),
          );
          incoming.forEach((t) => {
            map.set(adminTicketMergeKey(t), t);
          });
          return Array.from(map.values());
        });
        setLastUpdatedAt(Date.now());
      } catch {
        // Silent on poll — initial load already surfaced hard failures; avoid flicker/toast spam.
      } finally {
        dashboardPollInFlightRef.current = false;
      }
    };
    const tick = () => {
      void refresh();
    };
    const start = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(tick, DASHBOARD_POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") clear();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dashboardPollMountedRef.current = false;
      dashboardPollGenRef.current += 1;
      clear();
      document.removeEventListener("visibilitychange", onVis);
      dashboardPollInFlightRef.current = false;
    };
  }, [pageKey]);

  apiTicketsForAdminPagesRef.current = Array.isArray(apiTicketsForAdminPages)
    ? apiTicketsForAdminPages
    : [];

  // ── Admin tickets: real backend only ─────────────────────────────────────────
  // Always merge OPEN + PENDING + RESOLVED from the API; inbox tabs filter client-side only.
  // Avoids tickets “vanishing” when the backend moves OPEN → PENDING while an admin still has the Open tab selected.
  const refreshAdminTickets = useCallback(
    async ({ reason: refreshReason = "" } = {}) => {
      if (ticketsFetchRef.current.active) return;
      const reqSeq = (ticketsFetchRef.current.seq += 1);
      ticketsFetchRef.current.active = true;
      // Only show skeleton on first tickets load; background refresh keeps rows.
      if (!ticketsHasLoadedRef.current) setApiTicketsForAdminPagesLoading(true);
      try {
        const statuses = ["OPEN", "PENDING", "RESOLVED"];
        const settled = await Promise.allSettled(
          statuses.map((s) => adminDashboardApi.getTicketsByStatus(s)),
        );
        if (
          !ticketsMountedRef.current ||
          reqSeq !== ticketsFetchRef.current.seq
        )
          return;

        const incoming = [];
        /** @type {{ status: string, message: string }[]} */
        const failures = [];
        settled.forEach((r, i) => {
          if (r.status === "fulfilled") {
            const arr = Array.isArray(r.value) ? r.value : [];
            incoming.push(...arr);
          } else {
            failures.push({
              status: statuses[i],
              message: r.reason?.message || String(r.reason || "error"),
            });
          }
        });

        const prevSnap = apiTicketsForAdminPagesRef.current;
        const merged = mergeAdminTicketPages(prevSnap, incoming);

        setApiTicketsForAdminPages(merged);

        ticketsHasLoadedRef.current = true;
        setLastUpdatedAt(Date.now());
      } catch {
        // Intentionally quiet: list refresh is best-effort; per-status failures are surfaced via `failures` above.
      } finally {
        setApiTicketsForAdminPagesLoading(false);
        ticketsFetchRef.current.active = false;
      }
    },
    [],
  );

  useEffect(() => {
    if (pageKey !== "tickets") return;
    let alive = true;
    void (async () => {
      if (!alive) return;
      await refreshAdminTickets({ reason: "tickets page mount" });
    })();
    return () => {
      alive = false;
    };
  }, [pageKey, refreshAdminTickets]);

  // Background list refresh while the tickets workspace is open (same visibility rules as conversation poll).
  useEffect(() => {
    if (pageKey !== "tickets") return undefined;
    let intervalId = null;
    const clear = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const tick = () => {
      if (document.visibilityState === "visible") {
        void refreshAdminTickets({ reason: "list poll" });
      }
    };
    const start = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(tick, 15_000);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") clear();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pageKey, refreshAdminTickets]);

  // Admin Users list: GET /admin/users (real API only; no mock rows).
  useEffect(() => {
    if (pageKey !== "users") return;
    let alive = true;
    (async () => {
      setApiAdminUsersLoading(true);
      setApiAdminUsersLoadError(null);
      try {
        const list = await adminDashboardApi.listUsers();
        if (!alive) return;
        setApiAdminUsers(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!alive) return;
        setApiAdminUsers([]);
        setApiAdminUsersLoadError(err?.message || "Could not load users");
        showApiErrorToast("Could not load users", err);
      } finally {
        if (alive) setApiAdminUsersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pageKey, adminUsersReloadSeq]);

  // ── Admin KYC: real backend only (all + pending fallback) ───────────────────
  useEffect(() => {
    if (pageKey !== "kyc") return;
    void reloadKycList();
  }, [pageKey, reloadKycList]);

  useEffect(() => {
    if (pageKey !== "kyc") return;
    let intervalId = null;
    const clear = () => {
      if (intervalId != null) window.clearInterval(intervalId);
      intervalId = null;
    };
    const tick = () => {
      if (document.visibilityState === "visible") void reloadKycList();
    };
    const start = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(tick, KYC_ADMIN_POLL_MS);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") clear();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pageKey, reloadKycList]);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [brandingForm, setBrandingForm] = useState(brand);
  const [searchText, setSearchText] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [ticketSearchText, setTicketSearchText] = useState("");
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState("All");
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [activeTicket, setActiveTicket] = useState(null);
  const [activeMessages, setActiveMessages] = useState([]);
  const activeTicketFetchRef = useRef({ seq: 0 });
  const activeTicketReplyRef = useRef({ active: false, seq: 0 });
  const [userSearchText, setUserSearchText] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState("All");
  const [userRoleFilter, setUserRoleFilter] = useState("ALL");
  const [inviteAdminOpen, setInviteAdminOpen] = useState(false);
  const [roleChangeModalOpen, setRoleChangeModalOpen] = useState(false);
  const [roleChangeTarget, setRoleChangeTarget] = useState(null);
  const [roleChangeToRole, setRoleChangeToRole] = useState("");
  const [usersPage, setUsersPage] = useState(1);
  const [editingUser, setEditingUser] = useState(null);
  const [userEditForm, setUserEditForm] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [contactHistoryUser, setContactHistoryUser] = useState(null);
  const [userStatusUpdatingId, setUserStatusUpdatingId] = useState(null);
  const [userStatusConfirmFor, setUserStatusConfirmFor] = useState(null);

  useEffect(() => {
    const allowed = [
      "All",
      "ACTIVE",
      "INACTIVE",
      "PENDING",
      "BLOCKED",
      "SUSPENDED",
      "UNKNOWN",
    ];
    if (!allowed.includes(userStatusFilter)) setUserStatusFilter("All");
  }, [userStatusFilter]);
  const [kycSearchText, setKycSearchText] = useState("");
  const [kycStatusFilter, setKycStatusFilter] = useState("All");
  const [kycPage, setKycPage] = useState(1);
  const [kycDrawerRow, setKycDrawerRow] = useState(null);
  const [kycRejectFor, setKycRejectFor] = useState(null);
  const [kycRejectReasonDraft, setKycRejectReasonDraft] = useState("");
  const kycRejectReasonRef = useRef(null);
  const [kycReuploadFor, setKycReuploadFor] = useState(null);
  const [kycReuploadNoteDraft, setKycReuploadNoteDraft] = useState("");
  const [kycActionBusyId, setKycActionBusyId] = useState(null);

  const menuRef = useRef(null);
  const searchQuery = searchText.trim().toLowerCase();

  const summaryTotals = useMemo(
    () => ({
      totalUsers: toFiniteNumber(summary?.totalUsers, 0),
      activeUsers: toFiniteNumber(summary?.activeUsers, 0),
      totalApps: toFiniteNumber(summary?.totalApps, 0),
      openTickets: toFiniteNumber(summary?.openTickets, 0),
    }),
    [summary],
  );

  const dashboardAdminStats = useMemo(() => {
    const base =
      Array.isArray(adminStats) && adminStats.length
        ? adminStats
        : ADMIN_STATS_TEMPLATE;

    const toDisplay = (value) =>
      typeof value === "number" ? value.toLocaleString() : String(value ?? "0");

    // Compute admin user count if we have a fetched users list (best-effort exclusion).
    const adminCount = Array.isArray(apiAdminUsers)
      ? apiAdminUsers.filter((u) => {
          const tok = String(
            u?.role ?? u?.userRole ?? u?.type ?? "",
          ).toUpperCase();
          return (
            tok.includes("ADMIN") ||
            tok.includes("SUPPORT") ||
            tok.includes("STAFF")
          );
        }).length
      : 0;

    return base.map((card) => {
      if (card?.label === "Total Users") {
        return { ...card, value: toDisplay(summaryTotals.totalUsers) };
      }
      if (card?.label === "Active Users") {
        // Prefer excluding admins from active user metric when we have an admin list.
        const adjusted =
          adminCount > 0
            ? Math.max(0, summaryTotals.activeUsers - adminCount)
            : summaryTotals.activeUsers;
        return { ...card, value: toDisplay(adjusted) };
      }
      if (card?.label === "Total Apps") {
        return { ...card, value: toDisplay(summaryTotals.totalApps) };
      }
      if (card?.label === "Open Tickets") {
        return { ...card, value: toDisplay(summaryTotals.openTickets) };
      }
      if (card?.label === "Revenue") {
        return { ...card, value: "—" };
      }
      return card;
    });
  }, [adminStats, summaryTotals]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.groupCollapsed("[DASHBOARD_SUMMARY_AUDIT] UI pipeline");
    // eslint-disable-next-line no-console
    console.log("A) `summary` state (object from getSummary)", summary);
    // eslint-disable-next-line no-console
    console.log(
      "B) `summaryTotals` (toFiniteNumber applied in AdminDashboard)",
      summaryTotals,
    );
    // eslint-disable-next-line no-console
    console.log(
      "C) `dashboardAdminStats` card values (template + KPI overrides)",
      (dashboardAdminStats || []).map((c) => ({
        label: c.label,
        value: c.value,
      })),
    );
    // eslint-disable-next-line no-console
    console.groupEnd();
  }, [summary, summaryTotals, dashboardAdminStats]);

  const chartData = useMemo(() => {
    // API contract: [{ date, count }]. Keep support for numeric arrays too.
    if (Array.isArray(apiUserGrowth) && apiUserGrowth.length) {
      const normalized = apiUserGrowth
        .map((item, index) => normalizeGrowthPoint(item, index))
        .filter(Boolean);
      if (normalized.length) return normalized;
    }
    return [];
  }, [apiUserGrowth]);

  const growthChartModel = useMemo(
    () => buildGrowthChartModel(chartData),
    [chartData],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // eslint-disable-next-line no-console
    console.log("[DASHBOARD_GROWTH_AUDIT]", {
      rawApiUserGrowth: apiUserGrowth,
      normalizedChartData: chartData,
      renderModel: growthChartModel,
    });
  }, [apiUserGrowth, chartData, growthChartModel]);

  const dashboardUserGrowth = useMemo(
    () => chartData.map((item) => item.users),
    [chartData],
  );

  const dashboardActivityFeed = useMemo(() => {
    const source = Array.isArray(apiActivity) ? apiActivity : [];
    const items = source.map(normalizeActivityEntry).filter(Boolean);
    items.sort((a, b) => {
      const ta = toDateMs(a?.time);
      const tb = toDateMs(b?.time);
      const va = Number.isFinite(ta) ? ta : -Infinity;
      const vb = Number.isFinite(tb) ? tb : -Infinity;
      return vb - va;
    });
    return items;
  }, [apiActivity]);

  const dashboardRecentUsers = useMemo(() => {
    const items = Array.isArray(apiRecentUsers) ? apiRecentUsers : [];
    return items.slice(0, 5).map(normalizeAdminUserRow);
  }, [apiRecentUsers]);

  const dashboardOpenTickets = useMemo(() => {
    // Active Tickets card must be production-strict:
    // - Always show real admin API tickets (or empty state).
    const source = Array.isArray(apiTicketsForAdminPages)
      ? apiTicketsForAdminPages
      : [];
    const openOnly = source.filter(
      (t) => rawTicketCanonicalStatus(t) === "OPEN",
    );
    return openOnly.map(normalizeTicket);
  }, [apiTicketsForAdminPages]);

  const ticketsForAdminPages = useMemo(() => {
    return Array.isArray(apiTicketsForAdminPages)
      ? apiTicketsForAdminPages
      : [];
  }, [apiTicketsForAdminPages]);

  const normalizedTickets = useMemo(
    () => ticketsForAdminPages.map(normalizeTicket),
    [ticketsForAdminPages],
  );

  const computedTicketStats = useMemo(() => {
    // Keep UI unchanged but ensure counts reflect real data in production.
    const list = Array.isArray(normalizedTickets) ? normalizedTickets : [];
    return {
      total: list.length,
      open: list.filter((t) => normalizeTicketStatus(t.status) === "OPEN")
        .length,
      pending: list.filter((t) => normalizeTicketStatus(t.status) === "PENDING")
        .length,
      resolved: list.filter(
        (t) => normalizeTicketStatus(t.status) === "RESOLVED",
      ).length,
    };
  }, [normalizedTickets]);

  useEffect(() => {
    setBrandingForm(brand);
  }, [brand]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setShowNotifications(false);
        setShowProfileMenu(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const adminNotificationItems = useMemo(
    () =>
      (Array.isArray(inboxNotifications) ? inboxNotifications : []).map((n) => ({
        id: n.id,
        title: n.text,
        meta: toStringSafe(
          n.raw?.message ?? n.raw?.body ?? n.raw?.description ?? "",
          "",
        ),
        time: n.time,
        read: n.read,
      })),
    [inboxNotifications],
  );

  const unreadCount = inboxUnreadCount;

  // ── Filtered views (UI state + data) ───────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    const source = dashboardRecentUsers;
    if (!searchQuery) return source;
    return source.filter((item) =>
      `${toStringSafe(item.name)} ${toStringSafe(item.email)} ${toStringSafe(item.phone)} ${toStringSafe(item.joinedOnDisplay)} ${toStringSafe(item.statusMeta?.label ?? item.status)} ${item.kycPill?.label ?? ""}`
        .toLowerCase()
        .includes(searchQuery),
    );
  }, [searchQuery, dashboardRecentUsers]);

  const normalizedAdminUsersList = useMemo(
    () =>
      (Array.isArray(apiAdminUsers) ? apiAdminUsers : []).map(
        normalizeAdminUserRow,
      ),
    [apiAdminUsers],
  );

  const userRoleCounts = useMemo(
    () => ({
      all: normalizedAdminUsersList.length,
      admin: normalizedAdminUsersList.filter((u) => u.panelRole === "ADMIN")
        .length,
      owner: normalizedAdminUsersList.filter((u) => u.panelRole === "OWNER")
        .length,
    }),
    [normalizedAdminUsersList],
  );

  const userManagementRows = useMemo(() => {
    const query = userSearchText.trim().toLowerCase();
    return normalizedAdminUsersList.filter((user) => {
      const matchesSearch =
        !query ||
        `${user.id} ${user.name} ${user.email} ${user.phone} ${user.panelRole ?? ""} ${user.statusMeta?.label ?? user.status} ${user.kycPill?.label ?? ""}`
          .toLowerCase()
          .includes(query);
      const matchesStatus =
        userStatusFilter === "All" || user.statusMeta?.key === userStatusFilter;
      const matchesRole =
        userRoleFilter === "ALL" || user.panelRole === userRoleFilter;
      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [
    normalizedAdminUsersList,
    userSearchText,
    userStatusFilter,
    userRoleFilter,
  ]);

  const adminUsersDatasetEmpty =
    !apiAdminUsersLoading &&
    !apiAdminUsersLoadError &&
    normalizedAdminUsersList.length === 0;
  const adminUsersSearchOrFilterEmpty =
    !apiAdminUsersLoading &&
    normalizedAdminUsersList.length > 0 &&
    userManagementRows.length === 0;

  const userPageSize = 8;
  const totalUserPages = Math.max(
    1,
    Math.ceil(userManagementRows.length / userPageSize),
  );

  const paginatedUserRows = useMemo(() => {
    const start = (usersPage - 1) * userPageSize;
    return userManagementRows.slice(start, start + userPageSize);
  }, [userManagementRows, usersPage]);

  const kycNormalizedRows = useMemo(
    () =>
      (Array.isArray(apiKycRequests) ? apiKycRequests : []).map((raw, i) =>
        normalizeAdminKycRow(raw, i),
      ),
    [apiKycRequests],
  );

  const kycStats = useMemo(
    () => kycStatsFromNormalizedRows(kycNormalizedRows),
    [kycNormalizedRows],
  );

  const filteredKycRows = useMemo(() => {
    const query = kycSearchText.trim().toLowerCase();
    return kycNormalizedRows.filter((row) => {
      const hay =
        `${row.id} ${row.fullName} ${row.email} ${row.phone} ${row.documentType} ${row.documentNumber} ${row.canonicalStatus} ${row.statusRaw}`
          .toLowerCase()
          .replace(/\s+/g, " ");
      const matchesQuery = !query || hay.includes(query);
      const matchesStatus =
        kycStatusFilter === "All" || row.canonicalStatus === kycStatusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [kycNormalizedRows, kycSearchText, kycStatusFilter]);

  const totalKycPages = Math.max(
    1,
    Math.ceil(filteredKycRows.length / KYC_ADMIN_PAGE_SIZE),
  );

  const paginatedKycRows = useMemo(() => {
    const start = (kycPage - 1) * KYC_ADMIN_PAGE_SIZE;
    return filteredKycRows.slice(start, start + KYC_ADMIN_PAGE_SIZE);
  }, [filteredKycRows, kycPage]);

  useEffect(() => {
    setKycPage(1);
  }, [kycSearchText, kycStatusFilter]);

  useEffect(() => {
    if (kycPage > totalKycPages) setKycPage(totalKycPages);
  }, [kycPage, totalKycPages]);

  const handleKycApprove = useCallback(
    async (row) => {
      if (!adminKycRowHasActionableId(row)) return;
      setKycActionBusyId(row.id);
      try {
        await adminDashboardApi.verifyKyc(resolveKycApiPathId(row));
        await reloadKycList();
        bumpAdminUsersAfterKycModeration();
        invalidateDashboardData("admin-kyc-approved");
        showSuccess("KYC approved");
        setKycDrawerRow((prev) => {
          if (!prev || String(prev.id) !== String(row.id)) return prev;
          return {
            ...prev,
            canonicalStatus: KYC_CANONICAL.VERIFIED,
            displayStatus: kycCanonicalLabel(KYC_CANONICAL.VERIFIED),
            status: "VERIFIED",
            statusRaw: "VERIFIED",
          };
        });
      } catch (e) {
        showApiErrorToast("Failed to approve KYC", e);
      } finally {
        setKycActionBusyId(null);
      }
    },
    [reloadKycList, bumpAdminUsersAfterKycModeration],
  );

  useEffect(() => {
    if (!kycRejectFor) {
      setKycRejectReasonDraft("");
      return;
    }
    setKycRejectReasonDraft(
      sanitizeKycRejectReasonInput(kycRejectFor.rejectionReason),
    );
  }, [kycRejectFor]);

  const handleKycRejectConfirm = useCallback(async () => {
    const row = kycRejectFor;
    if (!row || !adminKycRowHasActionableId(row)) return;
    const reason = sanitizeKycRejectReasonInput(
      kycRejectReasonRef.current?.value ?? kycRejectReasonDraft,
    );
    if (!reason) {
      showError("Enter a rejection reason for the user.");
      return;
    }
    setKycActionBusyId(row.id);
    try {
      await adminDashboardApi.rejectKyc(
        resolveKycApiPathId(row),
        { reason, rejectionReason: reason },
      );
      await reloadKycList();
      bumpAdminUsersAfterKycModeration();
      invalidateDashboardData("admin-kyc-rejected");
      showSuccess("KYC rejected");
      setKycRejectFor(null);
      setKycRejectReasonDraft("");
      setKycDrawerRow((prev) => {
        if (!prev || String(prev.id) !== String(row.id)) return prev;
        return {
          ...prev,
          canonicalStatus: KYC_CANONICAL.REJECTED,
          displayStatus: kycCanonicalLabel(KYC_CANONICAL.REJECTED),
          status: "REJECTED",
          statusRaw: "REJECTED",
          rejectionReason: reason,
        };
      });
    } catch (e) {
      showApiErrorToast("Failed to reject KYC", e);
    } finally {
      setKycActionBusyId(null);
    }
  }, [kycRejectFor, kycRejectReasonDraft, reloadKycList, bumpAdminUsersAfterKycModeration]);

  const handleKycRequestReupload = useCallback(async () => {
    const row = kycReuploadFor;
    if (!row || !adminKycRowHasActionableId(row)) return;
    setKycActionBusyId(row.id);
    const note = kycReuploadNoteDraft.trim();
    try {
      await adminDashboardApi.patchKycApplicationStatus(resolveKycApiPathId(row), {
        status: "REUPLOAD_REQUIRED",
        ...(note ? { rejectionReason: note, message: note } : {}),
      });
      await reloadKycList();
      bumpAdminUsersAfterKycModeration();
      invalidateDashboardData("admin-kyc-reupload");
      showSuccess("Re-upload requested");
      setKycReuploadFor(null);
      setKycReuploadNoteDraft("");
      setKycDrawerRow((prev) => {
        if (!prev || String(prev.id) !== String(row.id)) return prev;
        return {
          ...prev,
          canonicalStatus: KYC_CANONICAL.REUPLOAD_REQUIRED,
          displayStatus: kycCanonicalLabel(KYC_CANONICAL.REUPLOAD_REQUIRED),
          status: "REUPLOAD_REQUIRED",
          statusRaw: "REUPLOAD_REQUIRED",
          ...(note ? { rejectionReason: note } : {}),
        };
      });
    } catch (e) {
      const st = e?.status;
      if (st === 404 || st === 405) {
        showApiErrorToast(
          "Re-upload failed: PATCH /admin/kyc/:id/status is missing or not allowed on this server (404/405).",
          e,
        );
      } else {
        showApiErrorToast("Failed to request re-upload", e);
      }
    } finally {
      setKycActionBusyId(null);
    }
  }, [kycReuploadFor, kycReuploadNoteDraft, reloadKycList, bumpAdminUsersAfterKycModeration]);

  const handleKycMarkUnderReview = useCallback(
    async (row) => {
      if (!adminKycRowHasActionableId(row)) return;
      setKycActionBusyId(row.id);
      try {
        await adminDashboardApi.patchKycApplicationStatus(resolveKycApiPathId(row), {
          status: "UNDER_REVIEW",
        });
        await reloadKycList();
        invalidateDashboardData("admin-kyc-under-review");
        showSuccess("Marked under review");
        setKycDrawerRow((prev) => {
          if (!prev || String(prev.id) !== String(row.id)) return prev;
          return {
            ...prev,
            canonicalStatus: KYC_CANONICAL.UNDER_REVIEW,
            displayStatus: kycCanonicalLabel(KYC_CANONICAL.UNDER_REVIEW),
            status: "UNDER_REVIEW",
            statusRaw: "UNDER_REVIEW",
          };
        });
      } catch (e) {
        const st = e?.status;
        if (st === 404 || st === 405) {
          showApiErrorToast(
            "Status update failed: PATCH /admin/kyc/:id/status is missing or not allowed on this server (404/405).",
            e,
          );
        } else {
          showApiErrorToast("Failed to update status", e);
        }
      } finally {
        setKycActionBusyId(null);
      }
    },
    [reloadKycList],
  );

  const closeKycDrawer = useCallback(() => {
    kycDrawerFetchGenRef.current += 1;
    setKycDrawerRow(null);
  }, []);

  const openKycDrawer = useCallback((row) => {
    setKycDrawerRow(row);
    if (!adminKycRowHasActionableId(row)) return;
    const gen = ++kycDrawerFetchGenRef.current;
    void (async () => {
      try {
        const detail = await adminDashboardApi.getKycDetail(resolveKycApiPathId(row));
        if (gen !== kycDrawerFetchGenRef.current) return;
        setKycDrawerRow((prev) => {
          if (!prev || String(prev.id) !== String(row.id)) return prev;
          return mergeAdminKycDetailRow(prev, detail);
        });
      } catch {
        // GET /kyc/:id optional; queue row still usable.
      }
    })();
  }, []);

  useEffect(() => {
    setKycDrawerRow((prev) => {
      if (!prev) return prev;
      const next = kycNormalizedRows.find((r) => r.id === prev.id);
      if (!next) return null;
      const patch = kycNormalizedRowToDetailPatch(prev);
      return Object.keys(patch).length
        ? mergeAdminKycDetailRow(next, patch)
        : next;
    });
  }, [kycNormalizedRows]);

  useEffect(() => {
    const anyOpen = Boolean(kycDrawerRow || kycRejectFor || kycReuploadFor);
    if (!anyOpen || pageKey !== "kyc") return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeKycDrawer();
      setKycRejectFor(null);
      setKycReuploadFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kycDrawerRow, kycRejectFor, kycReuploadFor, pageKey, closeKycDrawer]);

  useEffect(() => {
    setUsersPage(1);
  }, [userSearchText, userStatusFilter, userRoleFilter]);

  useEffect(() => {
    if (usersPage > totalUserPages) {
      setUsersPage(totalUserPages);
    }
  }, [usersPage, totalUserPages]);

  const filteredPayments = useMemo(() => {
    if (!searchQuery) return payments;
    return payments.filter((item) =>
      `${item.user} ${item.amount} ${item.status}`
        .toLowerCase()
        .includes(searchQuery),
    );
  }, [searchQuery, payments]);

  const dashboardFilteredTickets = useMemo(() => {
    const source = dashboardOpenTickets;
    if (!searchQuery) return source;
    return source.filter((item) =>
      `${item.subject} ${item.id} ${item.status} ${item.priority}`
        .toLowerCase()
        .includes(searchQuery),
    );
  }, [searchQuery, dashboardOpenTickets]);

  const dashboardTicketsSorted = useMemo(() => {
    const items = Array.isArray(dashboardFilteredTickets)
      ? [...dashboardFilteredTickets]
      : [];
    items.sort((a, b) => {
      const ta = toDateMs(
        a?.updatedAt ?? a?.lastUpdatedAt ?? a?.createdAt ?? a?.date ?? a?.time,
      );
      const tb = toDateMs(
        b?.updatedAt ?? b?.lastUpdatedAt ?? b?.createdAt ?? b?.date ?? b?.time,
      );
      const va = Number.isFinite(ta) ? ta : -Infinity;
      const vb = Number.isFinite(tb) ? tb : -Infinity;
      return vb - va;
    });
    return items;
  }, [dashboardFilteredTickets]);

  const dashboardTicketsToRender = useMemo(() => {
    return searchQuery
      ? dashboardTicketsSorted
      : dashboardTicketsSorted.slice(0, DASHBOARD_PANEL_MAX_ITEMS);
  }, [dashboardTicketsSorted, searchQuery]);

  const filteredTicketRows = useMemo(() => {
    const query = ticketSearchText.trim().toLowerCase();
    const prFilter = String(ticketPriorityFilter || "All").trim();
    const prIsAll = prFilter === "" || prFilter.toLowerCase() === "all";
    const rows = normalizedTickets.filter((ticket) => {
      const matchesQuery =
        !query ||
        `${toStringSafe(ticket.userId)} ${toStringSafe(ticket.userName)} ${toStringSafe(ticket.userEmail)} ${toStringSafe(ticket.subject)}`
          .toLowerCase()
          .includes(query);
      const matchesStatus =
        ticketStatusFilter === "All" ||
        normalizeTicketStatus(ticket.status) ===
          normalizeTicketStatus(ticketStatusFilter);
      const tPri = normalizeAdminPriorityLabel(ticket.priority);
      const matchesPriority =
        prIsAll ||
        tPri.toLowerCase() === prFilter.toLowerCase() ||
        normalizeAdminPriorityLabel(prFilter) === tPri;
      return matchesQuery && matchesStatus && matchesPriority;
    });
    const sorted = [...rows].sort((a, b) => {
      const ta = toDateMs(
        a?.updatedAt ?? a?.lastUpdatedAt ?? a?.createdAt ?? a?.date ?? a?.time,
      );
      const tb = toDateMs(
        b?.updatedAt ?? b?.lastUpdatedAt ?? b?.createdAt ?? b?.date ?? b?.time,
      );
      const va = Number.isFinite(ta) ? ta : -Infinity;
      const vb = Number.isFinite(tb) ? tb : -Infinity;
      return vb - va;
    });
    return sorted;
  }, [
    normalizedTickets,
    ticketSearchText,
    ticketStatusFilter,
    ticketPriorityFilter,
  ]);

  const selectedTicket = useMemo(
    () =>
      normalizedTickets.find(
        (ticket) => String(ticket.id) === String(selectedTicketId || ""),
      ) || null,
    [normalizedTickets, selectedTicketId],
  );

  const filteredActivity = useMemo(() => {
    const source = dashboardActivityFeed;
    if (!searchQuery) return source;
    return source.filter((item) =>
      `${item.event} ${item.meta} ${item.time}`
        .toLowerCase()
        .includes(searchQuery),
    );
  }, [searchQuery, dashboardActivityFeed]);

  const dashboardActivityToRender = useMemo(() => {
    if (!Array.isArray(filteredActivity)) return [];
    return searchQuery
      ? filteredActivity
      : filteredActivity.slice(0, DASHBOARD_PANEL_MAX_ITEMS);
  }, [filteredActivity, searchQuery]);

  const handleMarkAllNotificationsRead = () => {
    void inboxMarkAllRead();
  };

  const handleNotificationItemClick = (id) => {
    void inboxMarkOneRead(id);
    setShowNotifications(false);
    navigate("/admin/notifications");
  };

  const performUserStatusUpdate = async (userId, nextActive) => {
    if (userStatusUpdatingId) return;
    setUserStatusUpdatingId(userId);
    try {
      await withRetry(
        async () => {
          await adminDashboardApi.updateUserStatus(userId, nextActive);
        },
        { maxAttempts: ACTION_MAX_ATTEMPTS, label: "update user status" },
      );
      setAdminUsersReloadSeq((s) => s + 1);
      showSuccess(nextActive ? "User activated" : "User deactivated");
    } catch (e) {
      showApiErrorToast("Could not update user status", e);
    } finally {
      setUserStatusUpdatingId(null);
      setUserStatusConfirmFor(null);
    }
  };

  const handleUserStatusToggle = (userId) => {
    if (!ADMIN_USER_STATUS_UPDATE_AVAILABLE || userStatusUpdatingId) return;
    const found = userManagementRows.find((item) => item.id === userId);
    if (!found) return;
    const isActive = found.statusMeta?.key === "ACTIVE";
    if (isActive) {
      setUserStatusConfirmFor(found);
      return;
    }
    void performUserStatusUpdate(userId, true);
  };

  const handleManageRole = (targetUser) => {
    if (!targetUser) return;
    if (
      !canActorManageUserRole(
        role,
        targetUser,
        normalizedAdminUsersList,
        authProfile,
      )
    ) {
      showError("Role change is not permitted for this user.");
      return;
    }
    setRoleChangeTarget(targetUser);
    setRoleChangeToRole("");
    setRoleChangeModalOpen(true);
  };

  const closeRoleChangeModal = () => {
    setRoleChangeModalOpen(false);
    setRoleChangeTarget(null);
    setRoleChangeToRole("");
  };

  const handleUserView = (userId) => {
    const found = userManagementRows.find((item) => item.id === userId);
    if (!found) return;
    setEditingUser(found);
    setUserEditForm({
      name: found.displayName !== UNNAMED_USER_LABEL ? found.displayName : "",
      email: found.email !== "—" ? found.email : "",
      phone: found.phone !== "—" ? found.phone : "",
    });
  };

  const closeUserEditModal = () => {
    setEditingUser(null);
    setUserEditForm({ name: "", email: "", phone: "" });
  };

  const handleNavigateUserTickets = (user) => {
    const nav =
      user?.ticketsNav ?? pickTicketsNavQueryParts(user?._raw ?? user);
    if (!nav?.enabled || !String(nav.q || "").trim()) return;
    navigate(`/admin/tickets?q=${encodeURIComponent(String(nav.q).trim())}`);
  };

  const handleUsersExport = () => {
    const rows = userManagementRows;
    if (!rows.length) {
      showError("No users to export.");
      return;
    }
    const header = ["ID", "Name", "Email", "Phone", "KYC", "Joined", "Status"];
    const csvLines = [
      header.join(","),
      ...rows.map((user) =>
        [
          user.id,
          user.name,
          user.email,
          user.phone,
          user.kycPill?.label ?? "—",
          user.joinedOnDisplay ?? "—",
          user.statusMeta?.label ?? user.status ?? "—",
        ]
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "users-export.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleViewTicket = (ticketId) => {
    // Preserve filters/search in query params to support back-navigation.
    const qs = new URLSearchParams(location.search || "");
    const q = ticketSearchText.trim();
    if (q) qs.set("q", q);
    else qs.delete("q");
    if (ticketStatusFilter && ticketStatusFilter !== "All")
      qs.set("status", ticketStatusFilter);
    else qs.delete("status");
    if (ticketPriorityFilter && ticketPriorityFilter !== "All")
      qs.set("priority", ticketPriorityFilter);
    else qs.delete("priority");
    navigate(
      `/admin/tickets/${encodeURIComponent(String(ticketId))}${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  };

  const closeTicketPanel = () => {
    // Return to the list without losing filters/search.
    navigate(`/admin/tickets${location.search || ""}`);
  };

  const loadActiveTicket = async ({ reason: loadReason = "" } = {}) => {
    if (!activeTicketIdFromRoute) return;
    const seq = (activeTicketFetchRef.current.seq += 1);
    try {
      const raw = await adminDashboardApi.getTicketById(
        activeTicketIdFromRoute,
      );
      if (seq !== activeTicketFetchRef.current.seq) return;
      const { ticket: normTicket, threadSource } = normalizeTicketResponse(raw);
      const thread = normalizeTicketThread(threadSource);
      setActiveTicket(normTicket || null);
      setActiveMessages((prev) =>
        mergeMessages(prev, thread, {
          ticketId: activeTicketIdFromRoute,
          surface: "admin-detail",
          reason: loadReason,
        }),
      );
    } catch (err) {
      // Keep previous conversation visible (no flicker); surface toast only.
      showApiErrorToast("Failed to load ticket conversation", err);
    }
  };

  const handleSendTicketReply = async (text) => {
    const msg = String(text || "").trim();
    if (!activeTicketIdFromRoute || !msg) return;
    if (activeTicketReplyRef.current.active) return;
    const seq = (activeTicketReplyRef.current.seq += 1);
    activeTicketReplyRef.current.active = true;
    try {
      await adminDashboardApi.replyToTicket({
        ticketId: activeTicketIdFromRoute,
        id: activeTicketIdFromRoute,
        message: msg,
        body: msg,
      });
      showSuccess("Reply sent");
      await loadActiveTicket({ reason: "reply→resync" });
      await refreshAdminTickets({ reason: "reply→list resync" });
    } catch (err) {
      showApiErrorToast("Could not send reply", err);
      await loadActiveTicket({ reason: "reply failed→resync" });
    } finally {
      if (seq === activeTicketReplyRef.current.seq) {
        activeTicketReplyRef.current.active = false;
      }
    }
  };

  // Keep local filter state in sync with query params on first load.
  const ticketSearchInitializedRef = useRef(false);
  // Reset when leaving tickets so the next visit re-hydrates from `location.search`
  // (e.g. Admin Users → "View Tickets" with a new `?q=`).
  useEffect(() => {
    if (pageKey !== "tickets") {
      ticketSearchInitializedRef.current = false;
    }
  }, [pageKey]);
  // useLayoutEffect: apply URL → filter state before the sync useEffect runs, so we never
  // `qs.delete("q")` with stale ticketSearchText on the same navigation tick.
  useLayoutEffect(() => {
    if (pageKey !== "tickets") return;
    if (ticketSearchInitializedRef.current) return;
    ticketSearchInitializedRef.current = true;
    const qs = new URLSearchParams(location.search || "");
    const q = String(qs.get("q") || "");
    const userIdParam = String(qs.get("userId") || "").trim();
    const stRaw = String(qs.get("status") || "").trim();
    const pr = String(qs.get("priority") || "");
    // Always sync from URL when (re)entering tickets. Missing params must CLEAR stale filters,
    // otherwise inbox stays filtered while the dashboard widget (no ticketSearchText) still shows rows.
    if (q) setTicketSearchText(q);
    else if (userIdParam) setTicketSearchText(userIdParam);
    else setTicketSearchText("");
    if (stRaw) {
      const lower = stRaw.toLowerCase();
      if (lower === "all") setTicketStatusFilter("All");
      else setTicketStatusFilter(normalizeTicketStatus(stRaw));
    } else {
      setTicketStatusFilter("All");
    }
    if (pr) setTicketPriorityFilter(pr);
    else setTicketPriorityFilter("All");
  }, [pageKey, location.search]);

  // Update URL query params when filters change (replace, no history spam).
  useEffect(() => {
    if (pageKey !== "tickets") return;
    if (!ticketSearchInitializedRef.current) return;
    const qs = new URLSearchParams(location.search || "");
    const q = ticketSearchText.trim();
    const st = String(ticketStatusFilter || "");
    const pr = String(ticketPriorityFilter || "");
    if (q) qs.set("q", q);
    else qs.delete("q");
    if (st && st !== "All") qs.set("status", st);
    else qs.delete("status");
    if (pr && pr !== "All") qs.set("priority", pr);
    else qs.delete("priority");

    const nextSearch = qs.toString();
    const current = (location.search || "").replace(/^\?/, "");
    if (nextSearch !== current) {
      const base = activeTicketIdFromRoute
        ? `/admin/tickets/${encodeURIComponent(String(activeTicketIdFromRoute))}`
        : "/admin/tickets";
      navigate(`${base}${nextSearch ? `?${nextSearch}` : ""}`, {
        replace: true,
      });
    }
  }, [
    pageKey,
    ticketSearchText,
    ticketStatusFilter,
    ticketPriorityFilter,
    navigate,
    location.search,
    activeTicketIdFromRoute,
  ]);

  // Route → selection sync.
  useEffect(() => {
    if (pageKey !== "tickets") return;
    setSelectedTicketId(activeTicketIdFromRoute || null);
    setActiveTicket(null);
    setActiveMessages([]);
    if (activeTicketIdFromRoute) {
      void loadActiveTicket({ reason: "route selection" });
    }
  }, [pageKey, activeTicketIdFromRoute]);

  // Poll active conversation while visible (no websockets).
  useEffect(() => {
    if (pageKey !== "tickets" || !activeTicketIdFromRoute) return undefined;
    let intervalId = null;
    const clear = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const tick = () => {
      if (document.visibilityState === "visible") {
        void loadActiveTicket({ reason: "poll" });
      }
    };
    const start = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(tick, 10_000);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") clear();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pageKey, activeTicketIdFromRoute]);

  const handleBrandFieldChange = (key, value) => {
    setBrandingForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleLogoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setBrandingForm((prev) => ({
        ...prev,
        logoUrl:
          typeof reader.result === "string" ? reader.result : prev.logoUrl,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleBrandSave = () => {
    setBrand({
      name: brandingForm.name.trim() || defaultBrand.name,
      description: brandingForm.description.trim() || defaultBrand.description,
      logoUrl: brandingForm.logoUrl || defaultBrand.logoUrl,
    });
  };

  const renderPage = () => {
    if (pageKey === "dashboard" || pageKey === "analytics") {
      if (loading) {
        return (
          <div className="page-stack">
            <section
              className="stats-grid"
              aria-label="Loading dashboard summary"
            >
              {Array.from({ length: 5 }).map((_, idx) => (
                <article key={idx} className="metric-card">
                  <p className="metric-label">
                    <span className="skeleton sk-line sk-w-70" />
                  </p>
                  <p className="metric-value">
                    <span className="skeleton sk-line sk-w-55 sk-h-22" />
                  </p>
                  <svg
                    className="mini-chart"
                    viewBox="0 0 100 22"
                    preserveAspectRatio="none"
                  >
                    <rect
                      x="0"
                      y="0"
                      width="100"
                      height="22"
                      className="skeleton sk-rect"
                    />
                  </svg>
                </article>
              ))}
            </section>

            <section
              className="content-grid dashboard-grid"
              aria-label="Loading dashboard panels"
            >
              <article className="panel growth-panel">
                <div className="panel-head">
                  <h3>User Growth</h3>
                </div>
                <div className="growth-wrap">
                  <div className="growth-y-axis">
                    {Y_AXIS_LABELS.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                  <div className="skeleton sk-block sk-h-220" />
                  <div className="growth-x-axis">
                    {X_AXIS_LABELS.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                </div>
              </article>

              <article className="panel payments-panel">
                <div className="panel-head panel-head-inline">
                  <h3>Recent Payments</h3>
                </div>
                <ul className="payment-list">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <li key={idx} aria-hidden="true">
                      <div className="payment-user">
                        <span className="payment-avatar skeleton sk-circle" />
                        <div>
                          <p>
                            <span className="skeleton sk-line sk-w-55" />
                          </p>
                          <small>
                            <span className="skeleton sk-line sk-w-40" />
                          </small>
                        </div>
                      </div>
                      <div className="payment-meta">
                        <strong>
                          <span className="skeleton sk-line sk-w-40" />
                        </strong>
                        <span className="skeleton sk-pill sk-w-50" />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="panel activity-panel">
                <div className="panel-head">
                  <h3>Activity Feed</h3>
                </div>
                <ul className="timeline">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <li key={idx} aria-hidden="true">
                      <span className="timeline-dot skeleton sk-circle sk-dot" />
                      <div>
                        <p>
                          <span className="skeleton sk-line sk-w-80" />
                        </p>
                        <small>
                          <span className="skeleton sk-line sk-w-55" />
                        </small>
                      </div>
                      <time>
                        <span className="skeleton sk-line sk-w-45" />
                      </time>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="panel signups-panel">
                <div className="panel-head">
                  <h3>Recent Signups</h3>
                </div>
                <div className="table-wrap">
                  <div className="tickets-loading-state">
                    Loading signups...
                  </div>
                </div>
              </article>

              <article className="panel tickets-panel compact-panel">
                <div className="panel-head">
                  <h3>Active Tickets</h3>
                </div>
                <ul className="ticket-list simple-ticket-list">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <li key={idx} aria-hidden="true">
                      <div className="ticket-title-row">
                        <span className="ticket-dot skeleton sk-circle" />
                        <p>
                          <span className="skeleton sk-line sk-w-70" />
                        </p>
                      </div>
                      <div className="ticket-tags">
                        <span className="skeleton sk-pill sk-w-55" />
                        <span className="skeleton sk-pill sk-w-55" />
                        <span className="skeleton sk-pill sk-w-70" />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            </section>
          </div>
        );
      }
      // Do not early-return on error; preserve layout with safe empty values.

      const {
        hasGrowthData,
        coords,
        polylinePoints,
        areaPath,
        yAxisLabels,
        growthXLabels,
      } = growthChartModel;
      return (
        <div className="page-stack">
          {error ? (
            <p className="empty-state">{error || "No data available"}</p>
          ) : null}
          <div className="dashboard-meta-row">
            <span className="last-updated">
              {formatLastUpdated(lastUpdatedAt)}
            </span>
          </div>

          <section className="stats-grid">
            {(dashboardAdminStats || []).map((card) => (
              <article key={card.label} className={`metric-card ${card.tone}`}>
                <p className="metric-label">{card.label}</p>
                <p className="metric-value">{card.value}</p>
                {card.delta ? (
                  <span className="metric-delta">{card.delta}</span>
                ) : null}
                <svg
                  className="mini-chart"
                  viewBox="0 0 100 22"
                  preserveAspectRatio="none"
                >
                  <path
                    d={`M 0 22 L ${card.points} L 100 22 Z`}
                    className="mini-area"
                  />
                  <polyline points={card.points} />
                </svg>
              </article>
            ))}
          </section>

          <section className="content-grid dashboard-grid">
            <article className="panel growth-panel">
              <div className="panel-head">
                <div>
                  <h3>User Growth</h3>
                </div>
              </div>
              <div className="growth-wrap">
                {hasGrowthData ? (
                  <>
                    <div className="growth-y-axis">
                      {yAxisLabels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                    <svg
                      className="growth-chart"
                      viewBox="0 0 820 240"
                      preserveAspectRatio="none"
                      style={{ gridColumn: 2 }}
                    >
                      <defs>
                        <linearGradient
                          id="growthArea"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="rgba(59,130,246,0.28)" />
                          <stop
                            offset="100%"
                            stopColor="rgba(59,130,246,0.03)"
                          />
                        </linearGradient>
                      </defs>
                      <line
                        x1="30"
                        y1="220"
                        x2="790"
                        y2="220"
                        className="axis"
                      />
                      <line
                        x1="30"
                        y1="130"
                        x2="790"
                        y2="130"
                        className="grid"
                      />
                      <line x1="30" y1="40" x2="790" y2="40" className="grid" />
                      <path d={areaPath} className="area" />
                      <polyline points={polylinePoints} className="line" />
                      {coords.map(({ x, y, value }, index) => (
                        <circle
                          key={`${x}-${y}-${index}`}
                          cx={x}
                          cy={y}
                          r={coords.length === 1 ? 6 : 3.2}
                          className="marker"
                        />
                      ))}
                    </svg>
                    <div
                      className="growth-x-axis"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(
                          growthXLabels.length,
                          1,
                        )}, minmax(0, 1fr))`,
                      }}
                    >
                      {growthXLabels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="growth-empty">
                    <p className="empty-state">No growth data available</p>
                  </div>
                )}
              </div>
            </article>

            <article className="panel payments-panel">
              <div className="panel-head panel-head-inline">
                <h3>Recent Payments</h3>
                <button
                  type="button"
                  className="menu-icon-btn"
                  aria-label="More actions"
                >
                  <Icon name="menu" />
                </button>
              </div>
              <ul className="payment-list">
                {filteredPayments.map((payment) => (
                  <li key={`${payment.user}-${payment.time}`}>
                    <div className="payment-user">
                      <span className="payment-avatar">{payment.initials}</span>
                      <div>
                        <p>{payment.user}</p>
                        <small>{payment.time}</small>
                      </div>
                    </div>
                    <div className="payment-meta">
                      <strong>{payment.amount}</strong>
                      <span
                        className={`status-tag ${payment.status.toLowerCase()}`}
                      >
                        {payment.status}
                      </span>
                    </div>
                  </li>
                ))}
                {!filteredPayments.length && (
                  <li className="empty-state">
                    No payments found for this search.
                  </li>
                )}
              </ul>
            </article>

            <article className="panel activity-panel">
              <div className="panel-head">
                <h3>Activity Feed</h3>
              </div>
              <ul className="timeline">
                {dashboardActivityToRender.map((entry, index) => (
                  <li key={`${entry.time}-${entry.event}`}>
                    <span
                      className={`timeline-dot ${index === 0 ? "highlight" : ""}`}
                    />
                    <div>
                      <p>{entry.event}</p>
                      {entry.meta ? <small>{entry.meta}</small> : null}
                    </div>
                    <time>{entry.time}</time>
                  </li>
                ))}
                {!filteredActivity.length && (
                  <li className="empty-state">
                    {searchQuery
                      ? "No activity found for this search."
                      : "No recent activity"}
                  </li>
                )}
              </ul>
            </article>

            <article className="panel signups-panel">
              <div className="panel-head">
                <h3>Recent Signups</h3>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>{user.joinedOnDisplay ?? user.joinedOn}</td>
                      </tr>
                    ))}
                    {!filteredUsers.length && (
                      <tr>
                        <td colSpan={3} className="empty-table-row">
                          {searchQuery
                            ? "No data available"
                            : "No recent signups"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel tickets-panel compact-panel">
              <div className="panel-head">
                <h3>Active Tickets</h3>
              </div>
              <ul className="ticket-list simple-ticket-list">
                {dashboardTicketsToRender.map((ticket) => (
                  <li key={ticket.id}>
                    <div className="ticket-title-row">
                      <span
                        className={`ticket-dot ${ticket.priority.toLowerCase()}`}
                      />
                      <button
                        type="button"
                        className="ticket-dashboard-link"
                        onClick={() => handleViewTicket(ticket.id)}
                        title="Open conversation"
                      >
                        {ticket.subject}
                      </button>
                    </div>
                    <div className="ticket-tags">
                      <span
                        className={`priority-tag ${ticket.priority.toLowerCase()}`}
                      >
                        {ticket.priority}
                      </span>
                      <TicketBadge type="status" value={ticket.status} />
                      <button
                        type="button"
                        className="menu-icon-btn"
                        disabled={resolvingTicketIds.has(ticket.id)}
                        onClick={async () => {
                          if (resolvingTicketIds.has(ticket.id)) return;
                          setResolvingTicketIds((prev) => {
                            const next = new Set(prev);
                            next.add(ticket.id);
                            return next;
                          });
                          try {
                            await withRetry(
                              async () => {
                                await adminDashboardApi.resolveTicket(
                                  ticket.id,
                                );
                                await refreshAdminTickets({
                                  reason: "dashboard widget resolve",
                                });
                              },
                              {
                                maxAttempts: ACTION_MAX_ATTEMPTS,
                                label: "resolve ticket",
                              },
                            );
                            showSuccess("Ticket resolved successfully");
                          } catch (e) {
                            console.warn(
                              "[AdminDashboard] resolveTicket failed",
                              e,
                            );
                            setError(e?.message || "Failed to resolve ticket");
                            showApiErrorToast("Failed to resolve ticket", e);
                          } finally {
                            setResolvingTicketIds((prev) => {
                              const next = new Set(prev);
                              next.delete(ticket.id);
                              return next;
                            });
                          }
                        }}
                      >
                        {resolvingTicketIds.has(ticket.id)
                          ? "Resolving..."
                          : "Resolve"}
                      </button>
                    </div>
                  </li>
                ))}
                {!dashboardFilteredTickets.length && (
                  <li className="empty-state">
                    {searchQuery ? "No data available" : "No open tickets"}
                  </li>
                )}
              </ul>
            </article>

            <article className="panel quick-actions-panel compact-panel">
              <div className="panel-head">
                <h3>Quick Actions</h3>
              </div>
              <div className="quick-actions-column">
                <button type="button" className="primary-btn quick-action-btn">
                  Raise Ticket
                </button>
                <button type="button" className="primary-btn quick-action-btn">
                  Contact Support
                </button>
              </div>
            </article>
          </section>
        </div>
      );
    }

    if (pageKey === "users") {
      const usersEmptyMessage = (() => {
        if (apiAdminUsersLoading || paginatedUserRows.length) return null;
        if (apiAdminUsersLoadError) {
          return "Users could not be loaded. Use Retry above or check your connection.";
        }
        if (adminUsersDatasetEmpty)
          return "No users returned from the server yet.";
        if (adminUsersSearchOrFilterEmpty) {
          return "No users match your search or filters.";
        }
        return "No users to show.";
      })();
      return (
        <>
        <section className="content-grid one-column">
          <article className="panel users-management-shell">
            <div className="users-metrics-grid users-role-filter-grid">
              <article
                className={`users-metric-card users-role-filter-card${userRoleFilter === "ALL" ? " users-role-filter-card--active" : ""}`}
              >
                <button
                  type="button"
                  className="users-role-filter-btn"
                  onClick={() => setUserRoleFilter("ALL")}
                  aria-pressed={userRoleFilter === "ALL"}
                >
                  <div className="users-metric-head">
                    <span className="users-metric-icon users-metric-total">
                      <Icon name="users" />
                    </span>
                    <p>All Users</p>
                  </div>
                  <strong>{userRoleCounts.all.toLocaleString()}</strong>
                </button>
              </article>
              <article
                className={`users-metric-card users-role-filter-card${userRoleFilter === "ADMIN" ? " users-role-filter-card--active" : ""}`}
              >
                <button
                  type="button"
                  className="users-role-filter-btn"
                  onClick={() => setUserRoleFilter("ADMIN")}
                  aria-pressed={userRoleFilter === "ADMIN"}
                >
                  <div className="users-metric-head">
                    <span className="users-metric-icon users-metric-admin" />
                    <p>Admins</p>
                  </div>
                  <strong>{userRoleCounts.admin.toLocaleString()}</strong>
                </button>
              </article>
              <article
                className={`users-metric-card users-role-filter-card${userRoleFilter === "OWNER" ? " users-role-filter-card--active" : ""}`}
              >
                <button
                  type="button"
                  className="users-role-filter-btn"
                  onClick={() => setUserRoleFilter("OWNER")}
                  aria-pressed={userRoleFilter === "OWNER"}
                >
                  <div className="users-metric-head">
                    <span className="users-metric-icon users-metric-owner" />
                    <p>Owners</p>
                  </div>
                  <strong>{userRoleCounts.owner.toLocaleString()}</strong>
                </button>
              </article>
            </div>

            {apiAdminUsersLoadError ? (
              <div className="users-load-error-banner" role="alert">
                <p className="users-load-error-text">
                  {apiAdminUsersLoadError}
                </p>
                <button
                  type="button"
                  className="users-retry-btn"
                  onClick={() => setAdminUsersReloadSeq((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            ) : null}

            <div className="users-controls-row">
              <input
                type="text"
                className="users-control-input users-control-search"
                placeholder="Search name, email, phone…"
                value={userSearchText}
                onChange={(event) => setUserSearchText(event.target.value)}
              />

              <div className="users-controls-right">
                <select
                  className="users-control-input"
                  value={userStatusFilter}
                  onChange={(event) => setUserStatusFilter(event.target.value)}
                >
                  <option value="All">Status: All</option>
                  <option value="ACTIVE">Status: Active</option>
                  <option value="INACTIVE">Status: Inactive</option>
                  <option value="PENDING">Status: Pending</option>
                  <option value="BLOCKED">Status: Blocked</option>
                  <option value="SUSPENDED">Status: Suspended</option>
                  <option value="UNKNOWN">Status: Unknown</option>
                </select>
                <button
                  type="button"
                  className="users-invite-admin-btn"
                  onClick={() => setInviteAdminOpen(true)}
                  disabled={!canInviteAdmins(role)}
                  title={
                    canInviteAdmins(role)
                      ? "Invite a new admin"
                      : "Admin invite requires ADMIN or OWNER role"
                  }
                >
                  Invite Admin
                </button>
                <button
                  type="button"
                  className="users-export-btn"
                  onClick={() => handleUsersExport()}
                  disabled={!userManagementRows.length}
                >
                  Export
                </button>
              </div>
            </div>

            <div className="table-wrap users-table-wrap users-table-wrap--saas users-table-wrap--fixed-body">
              <table className="users-management-table users-management-table--saas">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Email</th>
                    <th scope="col">Phone</th>
                    <th scope="col">KYC</th>
                    <th scope="col">Tickets</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody className="users-table-body">
                  {apiAdminUsersLoading && !paginatedUserRows.length
                    ? Array.from({ length: 8 }).map((_, idx) => (
                        <tr
                          key={`users-sk-${idx}`}
                          className="users-table-skeleton-row"
                          aria-hidden
                        >
                          <td className="users-col-user">
                            <div className="users-skeleton-user">
                              <span className="skeleton users-skeleton-avatar" />
                              <div className="users-skeleton-text">
                                <span className="skeleton sk-line sk-w-70 sk-h-22" />
                                <span className="skeleton sk-line sk-w-45" />
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-block sk-w-80" />
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-w-55" />
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-pill sk-w-45" />
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-w-40" />
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-w-50" />
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-pill sk-w-40" />
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-pill sk-w-40" />
                          </td>
                          <td>
                            <span className="skeleton sk-line sk-w-70" />
                          </td>
                        </tr>
                      ))
                    : null}
                  {paginatedUserRows.map((user) => {
                    const userPhoto = extractProfilePhotoFromPayload(user);
                    const userPhotoUrl = userPhoto ? resolveProfilePhotoUrl(userPhoto) : "";
                    return (
                      <tr key={user.id}>
                        <td className="users-col-user">
                          <div className="users-cell-user">
                            <span className="users-avatar" aria-hidden style={{ overflow: "hidden" }}>
                              {userPhotoUrl ? (
                                <img
                                  src={userPhotoUrl}
                                  alt={user.displayName}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    borderRadius: "50%",
                                  }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : null}
                              <span style={{ display: userPhotoUrl ? "none" : "inline" }}>
                                {avatarInitialsFromDisplayName(user.displayName)}
                              </span>
                            </span>
                          <div className="users-cell-user-text">
                            <span className="users-cell-name">
                              {user.displayName}
                            </span>
                            <span className="users-cell-id">
                              {user.userId && user.userId !== user.id
                                ? user.userId
                                : user.id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="users-col-email">
                        <span className="users-cell-email">{user.email}</span>
                      </td>
                      <td className="users-col-phone">{user.phone}</td>
                      <td className="users-col-kyc">
                        <span
                          className={`users-kyc-pill users-kyc-pill--${user.kycPill.className}`}
                        >
                          {user.kycPill.label}
                        </span>
                      </td>
                      <td className="users-col-tickets">
                        <div className="users-tickets-cell">
                          {user.ticketCount != null ? (
                            <span
                              className="users-ticket-count"
                              title="Ticket count from API"
                            >
                              {user.ticketCount}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={
                              user.ticketCount != null
                                ? "users-tickets-btn users-tickets-btn--compact"
                                : "users-tickets-btn"
                            }
                            onClick={() => handleNavigateUserTickets(user)}
                            disabled={!user.ticketsNav?.enabled}
                            title={
                              !user.ticketsNav?.enabled
                                ? "No user identifier available for ticket search"
                                : undefined
                            }
                          >
                            View Tickets
                          </button>
                        </div>
                      </td>
                      <td className="users-col-joined">
                        {user.joinedOnDisplay}
                      </td>
                      <td className="users-col-role">
                        <AdminUserRoleBadge role={user.panelRole} compact />
                      </td>
                      <td>
                        <span
                          className={`status-badge users-status-pill ${user.statusMeta?.pillClass ?? "unknown"}`}
                        >
                          {user.statusMeta?.label ?? "Unknown"}
                        </span>
                      </td>
                      <td className="users-actions-cell">
                        <button
                          type="button"
                          className={`users-row-action users-row-toggle ${user.statusMeta?.key === "ACTIVE" ? "deactivate" : "activate"}`}
                          onClick={() => handleUserStatusToggle(user.id)}
                          disabled={
                            !ADMIN_USER_STATUS_UPDATE_AVAILABLE ||
                            userStatusUpdatingId === user.id
                          }
                          title={
                            !ADMIN_USER_STATUS_UPDATE_AVAILABLE
                              ? "Backend action not integrated yet"
                              : undefined
                          }
                        >
                          {user.statusMeta?.key === "ACTIVE"
                            ? "Deactivate"
                            : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="users-row-action users-row-edit"
                          onClick={() => handleUserView(user.id)}
                        >
                          View
                        </button>
                        {canActorManageUserRole(
                          role,
                          user,
                          normalizedAdminUsersList,
                          authProfile,
                        ) ? (
                          <button
                            type="button"
                            className="users-row-action users-row-role"
                            onClick={() => handleManageRole(user)}
                          >
                            Manage Role
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                  })}
                  {!apiAdminUsersLoading &&
                  !paginatedUserRows.length &&
                  usersEmptyMessage ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="empty-table-row users-empty-table-msg"
                      >
                        {usersEmptyMessage}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="users-pagination-row">
              <button
                type="button"
                className="users-page-btn"
                onClick={() => setUsersPage((prev) => Math.max(1, prev - 1))}
                disabled={usersPage === 1}
              >
                Previous
              </button>
              {Array.from({ length: totalUserPages }, (_, index) => index + 1)
                .slice(0, 5)
                .map((pageNo) => (
                  <button
                    key={pageNo}
                    type="button"
                    className={`users-page-btn users-page-number ${pageNo === usersPage ? "active" : ""}`}
                    onClick={() => setUsersPage(pageNo)}
                  >
                    {pageNo}
                  </button>
                ))}
              <button
                type="button"
                className="users-page-btn"
                onClick={() =>
                  setUsersPage((prev) => Math.min(totalUserPages, prev + 1))
                }
                disabled={usersPage === totalUserPages}
              >
                Next
              </button>
            </div>
          </article>
        </section>

          {editingUser ? (
            <div
              className="kyc-mod-modal-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closeUserEditModal();
              }}
            >
              <div className="kyc-mod-modal" role="dialog" aria-modal="true">
                <h4>View user</h4>
                <p className="kyc-mod-muted">
                  {editingUser.displayName} ·{" "}
                  <span className="kyc-mod-mono">{editingUser.id}</span>
                </p>
                <div className="users-view-role-row">
                  <span className="kyc-mod-label">Role</span>
                  <AdminUserRoleBadge role={editingUser.panelRole} />
                </div>
                <label className="kyc-mod-label" htmlFor="user-view-name">
                  Name
                </label>
                <input
                  id="user-view-name"
                  className="users-control-input"
                  value={userEditForm.name}
                  readOnly
                />
                <label className="kyc-mod-label" htmlFor="user-view-email">
                  Email
                </label>
                <input
                  id="user-view-email"
                  className="users-control-input"
                  type="email"
                  value={userEditForm.email}
                  readOnly
                />
                <label className="kyc-mod-label" htmlFor="user-view-phone">
                  Phone
                </label>
                <input
                  id="user-view-phone"
                  className="users-control-input"
                  value={userEditForm.phone}
                  readOnly
                />
                <div className="kyc-mod-modal-actions">
                  {canActorManageUserRole(
                    role,
                    editingUser,
                    normalizedAdminUsersList,
                    authProfile,
                  ) ? (
                    <button
                      type="button"
                      className="users-page-btn users-page-btn--role"
                      onClick={() => {
                        closeUserEditModal();
                        handleManageRole(editingUser);
                      }}
                    >
                      Change Role
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="users-page-btn"
                    onClick={() => setContactHistoryUser(editingUser)}
                  >
                    View previous contacts
                  </button>
                  <button
                    type="button"
                    className="users-page-btn"
                    onClick={closeUserEditModal}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {contactHistoryUser ? (
            <AdminContactHistoryPanel
              user={contactHistoryUser}
              userId={resolveAdminContactHistoryUserId(contactHistoryUser)}
              userLabel={contactHistoryUser.displayName}
              onClose={() => setContactHistoryUser(null)}
            />
          ) : null}

          {userStatusConfirmFor ? (
            <div
              className="kyc-mod-modal-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setUserStatusConfirmFor(null);
              }}
            >
              <div className="kyc-mod-modal" role="dialog" aria-modal="true">
                <h4>Deactivate user?</h4>
                <p className="kyc-mod-muted">
                  {userStatusConfirmFor.displayName} will lose access until
                  reactivated.
                </p>
                <div className="kyc-mod-modal-actions">
                  <button
                    type="button"
                    className="users-page-btn"
                    onClick={() => setUserStatusConfirmFor(null)}
                    disabled={userStatusUpdatingId === userStatusConfirmFor.id}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="users-row-action users-row-toggle deactivate"
                    disabled={userStatusUpdatingId === userStatusConfirmFor.id}
                    onClick={() =>
                      void performUserStatusUpdate(
                        userStatusConfirmFor.id,
                        false,
                      )
                    }
                  >
                    {userStatusUpdatingId === userStatusConfirmFor.id
                      ? "Updating…"
                      : "Confirm deactivate"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      );
    }

    if (pageKey === "kyc") {
      const kycSkeletonVisible =
        apiKycLoading && kycNormalizedRows.length === 0;
      const kycEmptyDataset =
        !apiKycLoading && !kycLoadError && kycNormalizedRows.length === 0;
      const kycFilterEmpty =
        !apiKycLoading &&
        kycNormalizedRows.length > 0 &&
        filteredKycRows.length === 0;

      const renderKycStatusBadge = (row) => (
        <span
          className={`status-badge kyc-status-pill kyc-status-pill--${kycCanonicalSlug(row.canonicalStatus)}`}
          title={row.statusRaw ? `API: ${row.statusRaw}` : undefined}
        >
          {row.displayStatus}
        </span>
      );

      const kycRowActions = (row, compact) => {
        const busy = kycActionBusyId === row.id;
        const actionable = adminKycRowHasActionableId(row);
        return (
          <div
            className={
              compact
                ? "kyc-mod-actions kyc-mod-actions--stack"
                : "kyc-mod-actions"
            }
          >
            <button
              type="button"
              className="users-row-action users-row-edit"
              onClick={() => openKycDrawer(row)}
            >
              Details
            </button>
            <button
              type="button"
              className="users-row-action users-row-edit"
              disabled={
                !actionable ||
                busy ||
                row.canonicalStatus === KYC_CANONICAL.VERIFIED
              }
              title={
                !actionable ? "Missing application id from API" : undefined
              }
              onClick={() => void handleKycApprove(row)}
            >
              {busy ? "…" : "Approve"}
            </button>
            <button
              type="button"
              className="users-row-action users-row-toggle deactivate"
              disabled={!actionable || busy}
              onClick={() => setKycRejectFor(row)}
            >
              Reject
            </button>
            <button
              type="button"
              className="users-row-action kyc-row-action-info"
              disabled={!actionable || busy}
              onClick={() => {
                setKycReuploadFor(row);
                setKycReuploadNoteDraft("");
              }}
            >
              Re-upload
            </button>
          </div>
        );
      };

      return (
        <section className="content-grid one-column">
          <article className="panel users-management-shell kyc-moderation-shell">
            <div className="kyc-mod-head">
              <div>
                <h3 className="kyc-mod-title">KYC moderation</h3>
                <p className="kyc-mod-sub">
                  Review submissions from the live queue. Actions call your
                  admin API; no local-only state.
                </p>
              </div>
              <div className="kyc-mod-head-actions">
                <button
                  type="button"
                  className="users-row-action users-row-edit"
                  onClick={() => void reloadKycList()}
                  disabled={apiKycLoading}
                >
                  {apiKycLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            {kycLoadError ? (
              <div
                className="kyc-mod-banner kyc-mod-banner--error"
                role="alert"
              >
                <span>{kycLoadError}</span>
                <button
                  type="button"
                  className="kyc-mod-banner-retry"
                  onClick={() => void reloadKycList()}
                >
                  Retry
                </button>
              </div>
            ) : null}

            <div className="users-metrics-grid kyc-metrics-grid">
              <article className="users-metric-card">
                <div className="users-metric-head">
                  <span className="users-metric-icon users-metric-total">
                    <Icon name="kyc" />
                  </span>
                  <p>Total</p>
                </div>
                <strong>{kycStats.total}</strong>
              </article>
              <article className="users-metric-card">
                <div className="users-metric-head">
                  <span className="users-metric-icon users-metric-pending" />
                  <p>Pending</p>
                </div>
                <strong>{kycStats.pending}</strong>
              </article>
              <article className="users-metric-card">
                <div className="users-metric-head">
                  <span className="users-metric-icon users-metric-review" />
                  <p>Under review</p>
                </div>
                <strong>{kycStats.underReview}</strong>
              </article>
              <article className="users-metric-card">
                <div className="users-metric-head">
                  <span className="users-metric-icon users-metric-active" />
                  <p>Verified</p>
                </div>
                <strong>{kycStats.approved}</strong>
              </article>
              <article className="users-metric-card">
                <div className="users-metric-head">
                  <span className="users-metric-icon users-metric-inactive" />
                  <p>Rejected</p>
                </div>
                <strong>{kycStats.rejected}</strong>
              </article>
              <article className="users-metric-card">
                <div className="users-metric-head">
                  <span className="users-metric-icon users-metric-reupload" />
                  <p>Re-upload</p>
                </div>
                <strong>{kycStats.reupload}</strong>
              </article>
            </div>

            <div className="users-controls-row kyc-mod-controls">
              <input
                type="text"
                className="users-control-input users-control-search"
                placeholder="Search name, email, phone, document #, request id…"
                value={kycSearchText}
                onChange={(event) => setKycSearchText(event.target.value)}
              />
              <div className="users-controls-right">
                <select
                  className="users-control-input"
                  value={kycStatusFilter}
                  onChange={(event) => setKycStatusFilter(event.target.value)}
                >
                  <option value="All">All statuses</option>
                  <option value={KYC_CANONICAL.PENDING}>Pending</option>
                  <option value={KYC_CANONICAL.UNDER_REVIEW}>
                    Under review
                  </option>
                  <option value={KYC_CANONICAL.VERIFIED}>Verified</option>
                  <option value={KYC_CANONICAL.REJECTED}>Rejected</option>
                  <option value={KYC_CANONICAL.REUPLOAD_REQUIRED}>
                    Re-upload required
                  </option>
                </select>
              </div>
            </div>

            <div
              className={`table-wrap users-table-wrap kyc-mod-table-desktop ${apiKycLoading && kycNormalizedRows.length > 0 ? "kyc-mod-table--dim" : ""}`}
            >
              <table className="users-management-table kyc-mod-table">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Phone</th>
                    <th>Document</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {kycSkeletonVisible
                    ? Array.from({ length: 6 }).map((_, sk) => (
                        <tr
                          key={`kyc-sk-${sk}`}
                          className="kyc-mod-skeleton-row"
                        >
                          <td colSpan={7}>
                            <div className="kyc-mod-skeleton-line" />
                          </td>
                        </tr>
                      ))
                    : null}
                  {!kycSkeletonVisible
                    ? paginatedKycRows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <div className="kyc-mod-usercell">
                              <span className="kyc-mod-avatar" aria-hidden>
                                {row.initials}
                              </span>
                              <div>
                                <strong>{row.fullName}</strong>
                                <p className="kyc-user-email">{row.email}</p>
                                <p className="kyc-mod-mono kyc-mod-id">
                                  {row.id}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td>{row.phone}</td>
                          <td>
                            <div className="kyc-mod-doccell">
                              <span>{row.documentType}</span>
                              {row.documentNumber !== "—" ? (
                                <span className="kyc-mod-mono">
                                  {row.documentNumber}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>{row.submittedAt}</td>
                          <td>{renderKycStatusBadge(row)}</td>
                          <td>
                            {row.riskFlag ? (
                              <span
                                className="kyc-mod-risk"
                                title="Flagged for review"
                              >
                                Flagged
                              </span>
                            ) : (
                              <span className="kyc-mod-muted">—</span>
                            )}
                          </td>
                          <td className="users-actions-cell kyc-actions-cell">
                            {kycRowActions(row, false)}
                          </td>
                        </tr>
                      ))
                    : null}
                  {!kycSkeletonVisible && kycEmptyDataset ? (
                    <tr>
                      <td colSpan={7} className="empty-table-row">
                        No KYC applications in the queue yet.
                      </td>
                    </tr>
                  ) : null}
                  {!kycSkeletonVisible && kycFilterEmpty ? (
                    <tr>
                      <td colSpan={7} className="empty-table-row">
                        No rows match this search or filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div
              className="kyc-mod-cards"
              aria-label="KYC applications (mobile layout)"
            >
              {kycSkeletonVisible
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={`kyc-card-sk-${i}`}
                      className="kyc-mod-card kyc-mod-card--skeleton"
                    >
                      <div className="kyc-mod-skeleton-line kyc-mod-skeleton-line--lg" />
                      <div className="kyc-mod-skeleton-line" />
                      <div className="kyc-mod-skeleton-line kyc-mod-skeleton-line--sm" />
                    </div>
                  ))
                : null}
              {!kycSkeletonVisible
                ? paginatedKycRows.map((row) => (
                    <div key={`m-${row.id}`} className="kyc-mod-card">
                      <div className="kyc-mod-card-top">
                        <span className="kyc-mod-avatar" aria-hidden>
                          {row.initials}
                        </span>
                        <div className="kyc-mod-card-top-text">
                          <strong>{row.fullName}</strong>
                          <span className="kyc-user-email">{row.email}</span>
                          {renderKycStatusBadge(row)}
                        </div>
                      </div>
                      <dl className="kyc-mod-dl">
                        <div>
                          <dt>Phone</dt>
                          <dd>{row.phone}</dd>
                        </div>
                        <div>
                          <dt>Document</dt>
                          <dd>
                            {row.documentType}
                            {row.documentNumber !== "—"
                              ? ` · ${row.documentNumber}`
                              : ""}
                          </dd>
                        </div>
                        <div>
                          <dt>Submitted</dt>
                          <dd>{row.submittedAt}</dd>
                        </div>
                      </dl>
                      {kycRowActions(row, true)}
                    </div>
                  ))
                : null}
              {!kycSkeletonVisible && (kycEmptyDataset || kycFilterEmpty) ? (
                <div className="kyc-mod-card kyc-mod-card--empty" role="status">
                  {kycEmptyDataset
                    ? "No applications in the queue."
                    : "No matches for this filter."}
                </div>
              ) : null}
            </div>

            <div className="users-pagination-row kyc-mod-pagination">
              <button
                type="button"
                className="users-page-btn"
                onClick={() => setKycPage((p) => Math.max(1, p - 1))}
                disabled={kycPage === 1}
              >
                Previous
              </button>
              <span className="kyc-mod-page-label">
                Page {kycPage} / {totalKycPages} · {filteredKycRows.length} row
                {filteredKycRows.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="users-page-btn"
                onClick={() =>
                  setKycPage((p) => Math.min(totalKycPages, p + 1))
                }
                disabled={kycPage === totalKycPages}
              >
                Next
              </button>
            </div>
          </article>

          {kycDrawerRow ? (
            <div
              className="kyc-mod-drawer-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closeKycDrawer();
              }}
            >
              <aside
                className="kyc-mod-drawer"
                role="dialog"
                aria-modal="true"
                aria-labelledby="kyc-drawer-title"
              >
                <div className="kyc-mod-drawer-head">
                  <div>
                    <p className="kyc-mod-drawer-kicker">Application</p>
                    <h4 id="kyc-drawer-title" className="kyc-mod-drawer-title">
                      {kycDrawerRow.fullName}
                    </h4>
                    <p className="kyc-user-email">{kycDrawerRow.email}</p>
                  </div>
                  <button
                    type="button"
                    className="kyc-mod-drawer-close"
                    onClick={closeKycDrawer}
                  >
                    Close
                  </button>
                </div>
                <div className="kyc-mod-drawer-body">
                  {renderKycStatusBadge(kycDrawerRow)}
                  <dl className="kyc-mod-detail-grid">
                    <div>
                      <dt>Request ID</dt>
                      <dd className="kyc-mod-mono">{kycDrawerRow.id}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{kycDrawerRow.phone}</dd>
                    </div>
                    <div>
                      <dt>Date of birth</dt>
                      <dd>{kycDrawerRow.dateOfBirth}</dd>
                    </div>
                    <div>
                      <dt>Country</dt>
                      <dd>{kycDrawerRow.country}</dd>
                    </div>
                    <div className="kyc-mod-detail-span">
                      <dt>Address</dt>
                      <dd>{kycDrawerRow.address}</dd>
                    </div>
                    <div>
                      <dt>Document type</dt>
                      <dd>{kycDrawerRow.documentType}</dd>
                    </div>
                    <div>
                      <dt>Document #</dt>
                      <dd className="kyc-mod-mono">
                        {kycDrawerRow.documentNumber}
                      </dd>
                    </div>
                    <div>
                      <dt>Submitted</dt>
                      <dd>{kycDrawerRow.submittedAt}</dd>
                    </div>
                    <div>
                      <dt>Reviewed by</dt>
                      <dd>{kycDrawerRow.reviewedBy}</dd>
                    </div>
                    <div>
                      <dt>Reviewed at</dt>
                      <dd>{kycDrawerRow.reviewedAt}</dd>
                    </div>
                  </dl>
                  {kycDrawerRow.rejectionReason ? (
                    <div className="kyc-mod-note">
                      <strong>Rejection / notes</strong>
                      <p>{kycDrawerRow.rejectionReason}</p>
                    </div>
                  ) : null}
                  <div className="kyc-mod-docs">
                    <AdminKycDocPreviews row={kycDrawerRow} />
                  </div>
                  <div className="kyc-mod-drawer-actions">
                    <button
                      type="button"
                      className="users-row-action users-row-edit"
                      disabled={
                        !adminKycRowHasActionableId(kycDrawerRow) ||
                        kycActionBusyId === kycDrawerRow.id ||
                        kycDrawerRow.canonicalStatus === KYC_CANONICAL.VERIFIED
                      }
                      onClick={() => void handleKycApprove(kycDrawerRow)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="users-row-action users-row-toggle deactivate"
                      disabled={
                        !adminKycRowHasActionableId(kycDrawerRow) ||
                        kycActionBusyId === kycDrawerRow.id
                      }
                      onClick={() => setKycRejectFor(kycDrawerRow)}
                    >
                      Reject…
                    </button>
                    <button
                      type="button"
                      className="users-row-action kyc-row-action-info"
                      disabled={
                        !adminKycRowHasActionableId(kycDrawerRow) ||
                        kycActionBusyId === kycDrawerRow.id
                      }
                      onClick={() => {
                        setKycReuploadFor(kycDrawerRow);
                        setKycReuploadNoteDraft("");
                      }}
                    >
                      Request re-upload…
                    </button>
                    <button
                      type="button"
                      className="users-row-action users-row-edit"
                      disabled={
                        !adminKycRowHasActionableId(kycDrawerRow) ||
                        kycActionBusyId === kycDrawerRow.id
                      }
                      onClick={() =>
                        void handleKycMarkUnderReview(kycDrawerRow)
                      }
                    >
                      Mark under review
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          ) : null}

          {kycRejectFor ? (
            <div
              className="kyc-mod-modal-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setKycRejectFor(null);
              }}
            >
              <div
                className="kyc-mod-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="kyc-reject-title"
              >
                <h4 id="kyc-reject-title">Reject KYC</h4>
                <p className="kyc-mod-muted">
                  {kycRejectFor.fullName} ·{" "}
                  <span className="kyc-mod-mono">{kycRejectFor.id}</span>
                </p>
                <label className="kyc-mod-label" htmlFor="kyc-reject-reason">
                  Rejection reason
                </label>
                <p className="kyc-mod-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                  Shown on the user&apos;s profile after reject.
                </p>
                <textarea
                  ref={kycRejectReasonRef}
                  id="kyc-reject-reason"
                  name="kycRejectionReason"
                  className="kyc-mod-textarea"
                  rows={4}
                  placeholder="e.g. Document is blurry. Please upload a clearer image."
                  value={kycRejectReasonDraft}
                  onChange={(e) => setKycRejectReasonDraft(e.target.value)}
                  autoComplete="off"
                />
                <div className="kyc-mod-modal-actions">
                  <button
                    type="button"
                    className="users-page-btn"
                    onClick={() => setKycRejectFor(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="users-row-action users-row-toggle deactivate"
                    disabled={kycActionBusyId === kycRejectFor.id}
                    onClick={() => void handleKycRejectConfirm()}
                  >
                    {kycActionBusyId === kycRejectFor.id
                      ? "Submitting…"
                      : "Confirm reject"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {kycReuploadFor ? (
            <div
              className="kyc-mod-modal-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setKycReuploadFor(null);
              }}
            >
              <div
                className="kyc-mod-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="kyc-reupload-title"
              >
                <h4 id="kyc-reupload-title">Request document re-upload</h4>
                <p className="kyc-mod-muted">
                  Sets status to <code>REUPLOAD_REQUIRED</code> via{" "}
                  <code className="kyc-mod-mono">
                    PATCH /admin/kyc/:id/status
                  </code>{" "}
                  on the live API.
                </p>
                <label className="kyc-mod-label" htmlFor="kyc-reupload-note">
                  Note to user (optional)
                </label>
                <textarea
                  id="kyc-reupload-note"
                  className="kyc-mod-textarea"
                  rows={3}
                  value={kycReuploadNoteDraft}
                  onChange={(e) => setKycReuploadNoteDraft(e.target.value)}
                />
                <div className="kyc-mod-modal-actions">
                  <button
                    type="button"
                    className="users-page-btn"
                    onClick={() => setKycReuploadFor(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="users-row-action users-row-edit"
                    disabled={kycActionBusyId === kycReuploadFor.id}
                    onClick={() => void handleKycRequestReupload()}
                  >
                    {kycActionBusyId === kycReuploadFor.id
                      ? "Submitting…"
                      : "Send request"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      );
    }

    if (pageKey === "apps") {
      return <AdminAppsSection />;
    }

    if (pageKey === "announcements") {
      return <AdminAnnouncements />;
    }

    if (pageKey === "billing") {
      return (
        <section className="content-grid one-column">
          <article className="panel payments-panel">
            <div className="panel-head">
              <h3>Billing and Payments</h3>
            </div>
            <ul className="payment-list">
              {filteredPayments.map((payment) => (
                <li key={`${payment.user}-${payment.time}`}>
                  <div className="payment-user">
                    <span className="payment-avatar">
                      {payment.user.slice(0, 1)}
                    </span>
                    <div>
                      <p>{payment.user}</p>
                      <small>{payment.time}</small>
                    </div>
                  </div>
                  <div className="payment-meta">
                    <strong>{payment.amount}</strong>
                    <span
                      className={`status-tag ${payment.status.toLowerCase()}`}
                    >
                      {payment.status}
                    </span>
                  </div>
                </li>
              ))}
              {!filteredPayments.length && (
                <li className="empty-state">
                  No payments found for this search.
                </li>
              )}
            </ul>
          </article>
        </section>
      );
    }

    if (pageKey === "tickets") {
      const resolved =
        normalizeTicketStatus(activeTicket?.status) === "RESOLVED";
      return (
        <section className="content-grid one-column">
          <article className="panel tickets-admin-shell">
            <div className="panel-head tickets-admin-head">
              <div>
                <h3>Support Tickets</h3>
                <p>
                  Track issues, respond quickly, and manage ticket lifecycle.
                </p>
              </div>
            </div>

            <div className="tickets-stats-grid">
              <article className="tickets-stat-card total">
                <p>Total Tickets</p>
                <strong>{computedTicketStats.total}</strong>
              </article>
              <article className="tickets-stat-card open">
                <p>Open</p>
                <strong>{computedTicketStats.open}</strong>
              </article>
              <article className="tickets-stat-card pending">
                <p>Pending</p>
                <strong>{computedTicketStats.pending}</strong>
              </article>
              <article className="tickets-stat-card resolved">
                <p>Resolved</p>
                <strong>{computedTicketStats.resolved}</strong>
              </article>
            </div>

            <div className="tickets-toolbar">
              <input
                type="text"
                className="tickets-toolbar-input search"
                value={ticketSearchText}
                onChange={(event) => setTicketSearchText(event.target.value)}
                placeholder="Search by user or subject"
              />
              <div
                className="tickets-filter-tabs"
                role="tablist"
                aria-label="Ticket status"
              >
                {[
                  {
                    key: "All",
                    label: "All",
                    count: computedTicketStats.total,
                  },
                  {
                    key: "OPEN",
                    label: "Open",
                    count: computedTicketStats.open,
                  },
                  {
                    key: "PENDING",
                    label: "Pending",
                    count: computedTicketStats.pending,
                  },
                  {
                    key: "RESOLVED",
                    label: "Resolved",
                    count: computedTicketStats.resolved,
                  },
                ].map(({ key, label, count }) => {
                  const active = ticketStatusFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`tickets-filter-tab ${active ? "active" : ""}`}
                      onClick={() => setTicketStatusFilter(key)}
                    >
                      <span className="tickets-filter-tab-label">{label}</span>
                      <span className="tickets-filter-tab-count">
                        {Number(count) || 0}
                      </span>
                    </button>
                  );
                })}
              </div>
              <select
                className="tickets-toolbar-input"
                value={ticketPriorityFilter}
                onChange={(event) =>
                  setTicketPriorityFilter(event.target.value)
                }
              >
                <option value="All">Priority: All</option>
                <option value="Low">Priority: Low</option>
                <option value="Medium">Priority: Medium</option>
                <option value="High">Priority: High</option>
              </select>
            </div>

            <div className="tickets-inbox">
              <div className="tickets-inbox-list">
                <div className="tickets-inbox-list-head">
                  <strong>Inbox</strong>
                  <button
                    type="button"
                    className="tickets-inbox-refresh"
                    onClick={() =>
                      void refreshAdminTickets({ reason: "manual refresh" })
                    }
                    disabled={apiTicketsForAdminPagesLoading}
                  >
                    {apiTicketsForAdminPagesLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>

                {apiTicketsForAdminPagesLoading &&
                !filteredTicketRows.length ? (
                  <div className="tickets-loading-state">
                    Loading tickets...
                  </div>
                ) : (
                  <div className="tickets-inbox-rows" role="list">
                    {filteredTicketRows.map((t) => {
                      const id = String(t.id);
                      const active = String(selectedTicketId || "") === id;
                      const updatedRaw =
                        t?.updatedAt ||
                        t?.lastUpdatedAt ||
                        t?.createdAt ||
                        t?.date;
                      const updated = updatedRaw
                        ? new Date(updatedRaw).toLocaleString()
                        : "";
                      const preview = String(
                        t?.description || t?.subject || "",
                      ).trim();
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`tickets-inbox-row ${active ? "active" : ""}`}
                          onClick={() => handleViewTicket(id)}
                          role="listitem"
                        >
                          <div className="tickets-inbox-row-top">
                            <div className="tickets-inbox-title">
                              <span className="tickets-inbox-subject">
                                {t.subject}
                              </span>
                              <span className="tickets-inbox-id">#{id}</span>
                            </div>
                            <span className="tickets-inbox-time">
                              {updated}
                            </span>
                          </div>
                          <div className="tickets-inbox-row-mid">
                            <span className="tickets-inbox-user">
                              {t.userName}
                              {t.userEmail && t.userEmail !== "—"
                                ? ` · ${t.userEmail}`
                                : ""}
                            </span>
                            <span className="tickets-inbox-pills">
                              <TicketBadge
                                type="status"
                                value={normalizeTicketStatus(t.status)}
                              />
                            </span>
                          </div>
                          {preview ? (
                            <div className="tickets-inbox-preview">
                              {preview}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                    {!filteredTicketRows.length ? (
                      <div className="tickets-inbox-empty">
                        {ticketStatusFilter !== "All" ? (
                          <>
                            No tickets in this view.
                            <div className="tickets-inbox-empty-hint">
                              Try <strong>All</strong> or{" "}
                              <strong>Pending</strong> — the backend may move
                              tickets to Pending after a user replies.
                            </div>
                          </>
                        ) : (
                          "No tickets found."
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="tickets-inbox-panel">
                {selectedTicketId ? (
                  <TicketConversation
                    title={
                      activeTicket?.title || activeTicket?.subject || "Ticket"
                    }
                    meta={`${selectedTicketId} • ${activeTicket?.userName || ""}${activeTicket?.userEmail ? ` • ${activeTicket.userEmail}` : ""}`}
                    status={normalizeTicketStatus(
                      activeTicket?.status || "OPEN",
                    )}
                    messages={activeMessages}
                    viewerIsAdmin
                    canReply={!resolved}
                    resolvedNotice={resolved}
                    rightLabel="Admin"
                    leftLabel="User"
                    onSend={handleSendTicketReply}
                    headerActions={
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        <button
                          type="button"
                          className="tickets-panel-action primary"
                          disabled={
                            resolved ||
                            (selectedTicketId &&
                              resolvingTicketIds.has(selectedTicketId))
                          }
                          onClick={() =>
                            void (async () => {
                              if (!selectedTicketId) return;
                              // optimistic UI: mark resolving and locally set status to RESOLVED
                              setResolvingTicketIds((prev) => {
                                const next = new Set(prev);
                                next.add(selectedTicketId);
                                return next;
                              });
                              setActiveTicket((prev) =>
                                prev ? { ...prev, status: "RESOLVED" } : prev,
                              );
                              setApiTicketsForAdminPages((prev) =>
                                (Array.isArray(prev) ? prev : []).map((t) =>
                                  String(t?.id) === String(selectedTicketId) ||
                                  String(t?.ticketId) ===
                                    String(selectedTicketId)
                                    ? { ...t, status: "RESOLVED" }
                                    : t,
                                ),
                              );
                              try {
                                await adminDashboardApi.patchTicketStatus(
                                  selectedTicketId,
                                  "RESOLVED",
                                );
                                await refreshAdminTickets({
                                  reason: "inbox resolve",
                                });
                                await loadActiveTicket({
                                  reason: "inbox resolve→resync",
                                });
                                showSuccess("Ticket resolved");
                              } catch (e) {
                                // revert optimistic changes by reloading from server
                                await refreshAdminTickets({
                                  reason: "inbox resolve→resync failed",
                                }).catch(() => {});
                                await loadActiveTicket({
                                  reason: "inbox resolve→resync failed",
                                }).catch(() => {});
                                showApiErrorToast(
                                  "Failed to resolve ticket",
                                  e,
                                );
                              } finally {
                                setResolvingTicketIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(selectedTicketId);
                                  return next;
                                });
                              }
                            })()
                          }
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          className="tickets-panel-action"
                          onClick={() =>
                            void loadActiveTicket({
                              reason: "manual conversation refresh",
                            })
                          }
                        >
                          Refresh
                        </button>
                        <button
                          type="button"
                          className="tickets-panel-action"
                          onClick={closeTicketPanel}
                        >
                          Back
                        </button>
                      </div>
                    }
                  />
                ) : (
                  <div className="tickets-inbox-placeholder">
                    <div>
                      <h4>Select a ticket</h4>
                      <p>
                        Choose a ticket from the left to view the conversation.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </article>
        </section>
      );
    }

    if (pageKey === "notifications") {
      return (
        <section className="content-grid one-column">
          <article className="panel activity-panel">
            <div className="panel-head">
              <h3>Notifications and Activity</h3>
            </div>
            <ul className="timeline">
              {dashboardActivityToRender.map((entry) => (
                <li key={`${entry.time}-${entry.event}`}>
                  <span className="timeline-dot" />
                  <div>
                    <p>{entry.event}</p>
                    <small>{entry.meta}</small>
                  </div>
                  <time>{entry.time}</time>
                </li>
              ))}
              {!filteredActivity.length && (
                <li className="empty-state">
                  No activity found for this search.
                </li>
              )}
            </ul>
          </article>
        </section>
      );
    }

    return (
      <section className="content-grid one-column">
        <article className="panel support-panel">
          <div className="panel-head">
            <h3>Settings</h3>
          </div>
          <p className="panel-note">
            Update branding and admin preferences for your workspace.
          </p>

          <div className="branding-editor">
            <h4>Branding</h4>
            <div className="brand-preview">
              <img
                src={brandingForm.logoUrl || defaultBrand.logoUrl}
                alt={brandingForm.name || defaultBrand.name}
                onError={(e) => {
                  e.currentTarget.src = defaultBrand.logoUrl;
                }}
              />
              <div>
                <p>{brandingForm.name || defaultBrand.name}</p>
                <small>
                  {brandingForm.description || defaultBrand.description}
                </small>
              </div>
            </div>

            <label htmlFor="brand-name">App Name</label>
            <input
              id="brand-name"
              type="text"
              value={brandingForm.name}
              onChange={(e) => handleBrandFieldChange("name", e.target.value)}
              placeholder="Bold and Wise"
            />

            <label htmlFor="brand-desc">App Description</label>
            <textarea
              id="brand-desc"
              value={brandingForm.description}
              onChange={(e) =>
                handleBrandFieldChange("description", e.target.value)
              }
              placeholder="Short app description"
            />

            <div className="branding-actions">
              <label
                htmlFor="brand-logo-upload"
                className="secondary-btn upload-btn"
              >
                Upload Logo
              </label>
              <input
                id="brand-logo-upload"
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
              />
              <button
                type="button"
                className="primary-btn"
                onClick={handleBrandSave}
              >
                Save
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  resetBrand();
                  setSearchText("");
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </article>
      </section>
    );
  };

  const activeItem =
    ADMIN_SIDEBAR_ITEMS.find((item) => item.key === pageKey) ||
    ADMIN_SIDEBAR_ITEMS[0];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand-block">
          <div className="brand-logo-wrap">
            <img
              src={brandingForm.logoUrl || defaultBrand.logoUrl}
              alt={brandingForm.name || defaultBrand.name}
              onError={(e) => {
                e.currentTarget.src = defaultBrand.logoUrl;
              }}
            />
          </div>
          <div>
            <p className="brand-kicker">Bold and Wise</p>
            <h1>{brandingForm.name || defaultBrand.name}</h1>
          </div>
        </div>

        <nav className="admin-nav">
          {ADMIN_SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`admin-nav-item ${activeItem.key === item.key ? "active" : ""}`}
              onClick={() => navigate(item.path)}
            >
              <span className="admin-nav-icon">
                <Icon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="welcome-subtitle">Bold and Wise Control Center</p>
            <h2>{activeItem.label}</h2>
          </div>

          <div className="topbar-actions">
            <div className="topbar-search">
              <span className="search-icon">
                <Icon name="search" />
              </span>
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search in current page..."
              />
            </div>

            <div className="menu-group" ref={menuRef}>
              <div className="menu-anchor">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Notifications"
                  onClick={() => {
                    setShowProfileMenu(false);
                    setShowNotifications((prev) => {
                      const next = !prev;
                      if (next) void refreshInboxNotifications({ force: true });
                      return next;
                    });
                  }}
                >
                  <Icon name="notifications" />
                  {unreadCount > 0 && <span className="notif-dot" />}
                </button>

                {showNotifications && (
                  <div className="dropdown-panel notif-dropdown">
                    <div className="dropdown-header">
                      <strong>Notifications</strong>
                      {adminNotificationItems.some((n) => !n.read) ? (
                        <button
                          type="button"
                          onClick={handleMarkAllNotificationsRead}
                          disabled={inboxNotifLoading}
                        >
                          Mark all read
                        </button>
                      ) : null}
                    </div>
                    {inboxNotifError ? (
                      <p className="empty-state" style={{ padding: "8px 12px" }}>
                        {inboxNotifError}
                      </p>
                    ) : null}
                    {inboxNotifLoading && !adminNotificationItems.length ? (
                      <p className="empty-state" style={{ padding: "8px 12px" }}>
                        Loading…
                      </p>
                    ) : null}
                    {!inboxNotifLoading && !adminNotificationItems.length && !inboxNotifError ? (
                      <p className="empty-state" style={{ padding: "8px 12px" }}>
                        No notifications yet
                      </p>
                    ) : null}
                    <ul>
                      {adminNotificationItems.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => handleNotificationItemClick(item.id)}
                          >
                            <span
                              className={`notif-indicator ${item.read ? "read" : "unread"}`}
                            />
                            <span>
                              <p>{item.title}</p>
                              <small>{item.meta}</small>
                            </span>
                            <time>{item.time}</time>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="menu-anchor">
                <button
                  type="button"
                  className="admin-avatar"
                  aria-label="Admin profile"
                  onClick={() => {
                    setShowNotifications(false);
                    setShowProfileMenu((prev) => !prev);
                  }}
                  style={{ overflow: "hidden" }}
                >
                  {profilePhotoUrl ? (
                    <img
                      src={profilePhotoUrl}
                      alt={user?.name || "Admin"}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: "50%",
                      }}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <span style={{ display: profilePhotoUrl ? "none" : "inline" }}>
                    {getInitials(user?.name || "Admin")}
                  </span>
                </button>

                {showProfileMenu && (
                  <div className="dropdown-panel profile-dropdown">
                    <button type="button" onClick={() => navigate("/profile")}>
                      My Profile
                    </button>
                    <button type="button" onClick={() => navigate("/settings")}>
                      Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        logout();
                        navigate("/login");
                      }}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {renderPage()}
      </main>

      <AdminInviteModal
        open={inviteAdminOpen}
        onClose={() => setInviteAdminOpen(false)}
        inviterRole={role}
        inviterEmail={user?.email || user?.userEmail || ""}
        onInviteSent={() => setAdminUsersReloadSeq((n) => n + 1)}
      />

      <AdminRoleChangeModal
        open={roleChangeModalOpen}
        onClose={closeRoleChangeModal}
        targetUser={roleChangeTarget}
        toRole={roleChangeToRole}
        actorRole={role}
        allRows={normalizedAdminUsersList}
        actorProfile={authProfile}
        actorEmail={user?.email || user?.userEmail || ""}
        onRoleChanged={() => setAdminUsersReloadSeq((n) => n + 1)}
      />
    </div>
  );
}
