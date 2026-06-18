import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getGreetingFirstName, useAuth } from "../context/AuthContext";
import { dashboardApi } from "../services";
import {
  readDashboardBundleCache,
  writeDashboardBundleCacheIfComplete,
} from "../services/dashboardBundleCache";
import {
  readRecentAppsCache,
  writeRecentAppsCache,
} from "../services/recentAppsCache";
import { getUsageTimeseriesCache } from "../services/usageTimeseriesCache";
import { DASHBOARD_INVALIDATE_EVENT, invalidateDashboardData } from "../services/dashboardInvalidate";
import { announcementsApi } from "../services/announcementsApi";
import { announcementWhatsNewItem } from "../utils/announcements";
import { onAppsCatalogChanged, onMyAppsChanged } from "../services/uiEvents";
import { extractApiArrayAndMeta, peelRepeatedApiEnvelope } from "../utils/apiEnvelope";
import {
  activityBackend,
  dashboardBackend,
  ticketsBackend,
  applicationBackend,
} from "../services/backendApis";
import { withRetryOnce } from "../services/withRetryOnce";
import { showSuccess, showError } from "../services/toast";
import { normalizeUsageTimeseriesPayload, usageIntervalForRange } from "../utils/usageTimeseries";
import { recordDashboardUsageAppPick } from "../utils/usageAppSelectionAnalytics";
import { openUserCatalogApp } from "../utils/appNavigation";
import {
  catalogCountFromListResponse,
  dashboardSummaryNormalize,
} from "../utils/dashboardSummary";
import {
  normalizeRecentAppsPayload,
  normalizeMyAppsUsageOptions,
} from "../utils/recentApps";
import AppCatalogLogo from "../components/AppCatalogLogo";
import { canonicalizeKycStatus, kycCanonicalLabel, KYC_CANONICAL } from "../utils/kycAdmin";
import "./UserDashboard.css";

const AppUsageChart = lazy(() => import("./AppUsageChart"));

const USAGE_APP_STORAGE_KEY = "bw_dashboard_usage_app_v1";

const DASHBOARD_TXN_PAGE_SIZE = 80;
/** Avoid duplicate global toasts on partial failures — errors surface per dashboard section */
const DASHBOARD_API_QUIET = { suppressGlobalServerErrorToast: true };
const DASHBOARD_POLL_MS = 60_000;
const DASHBOARD_AUTOREFRESH_ENABLED =
  import.meta.env.VITE_DASHBOARD_AUTOREFRESH !== "false";
const IS_DEV = import.meta.env.DEV;
const DEBUG_DASHBOARD = import.meta.env.VITE_DEBUG_DASHBOARD === "true";

/** Tracks in-flight usage timeseries keys (kept in sync with coalescing map below). */
const inFlightUsageRequests = new Set();
const usageTimeseriesInflightPromises = new Map();

function usageInflightRequestKey(appId, range) {
  return `${String(appId)}_${String(range)}`;
}

/** Single network GET per appId+range when prefetch and main fire together; shared promise for all subscribers. */
function coalesceUsageTimeseriesFetch(inflightKey, startFn) {
  let p = usageTimeseriesInflightPromises.get(inflightKey);
  if (p) return p;
  inFlightUsageRequests.add(inflightKey);
  p = Promise.resolve(startFn()).finally(() => {
    inFlightUsageRequests.delete(inflightKey);
    usageTimeseriesInflightPromises.delete(inflightKey);
  });
  usageTimeseriesInflightPromises.set(inflightKey, p);
  return p;
}

// React 18 StrictMode (dev) mounts → runs effects → unmounts → mounts again.
// To avoid duplicate network calls on the initial dashboard entry, we de-dupe
// the *first* load within a short window, but keep refresh/poll behavior intact.
let _dashboardInitialLoadPromise = null;
let _dashboardInitialLoadStartedAt = 0;
const DASHBOARD_INITIAL_DEDUPE_MS = 1200;

async function fetchDashboardInitialBundleFromNetwork(onRetrying) {
  const q = DASHBOARD_API_QUIET;
  const wrap = (fn) => withRetryOnce(fn, { onRetrying });
  return Promise.allSettled([
    wrap(() => dashboardApi.getSummary(q)),
    wrap(() =>
      dashboardApi.getTransactions(0, DASHBOARD_TXN_PAGE_SIZE, q),
    ),
    wrap(() => ticketsBackend.my(q)),
    wrap(() => activityBackend.list({ page: 0, size: 10, ...q })),
  ]);
}

/** Normalize Spring `Page` or array responses from GET /dashboard/transactions */
function normalizeDashboardTxnPage(body) {
  if (body == null) {
    return {
      content: [],
      totalPages: 1,
      totalElements: 0,
      last: true,
      number: 0,
    };
  }
  if (Array.isArray(body)) {
    return {
      content: body,
      totalPages: 1,
      totalElements: body.length,
      last: true,
      number: 0,
    };
  }
  const content = Array.isArray(body.content)
    ? body.content
    : Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.records)
        ? body.records
        : [];
  const totalElements = Number(body.totalElements ?? body.total ?? content.length) || 0;
  const totalPages = Math.max(1, Number(body.totalPages) || 1);
  const number = Number(body.number ?? body.page ?? 0) || 0;
  const last =
    body.last !== undefined ? Boolean(body.last) : number >= totalPages - 1;
  return {
    content,
    totalPages,
    totalElements,
    last,
    number,
  };
}

function getInitialDashboardBundleDeduped(onRetrying) {
  const now = Date.now();
  if (
    _dashboardInitialLoadPromise &&
    now - _dashboardInitialLoadStartedAt < DASHBOARD_INITIAL_DEDUPE_MS
  ) {
    return _dashboardInitialLoadPromise;
  }
  _dashboardInitialLoadStartedAt = now;
  _dashboardInitialLoadPromise = fetchDashboardInitialBundleFromNetwork(onRetrying).finally(() => {
    // Keep it around briefly for StrictMode remount, then allow real reloads.
    window.setTimeout(() => {
      _dashboardInitialLoadPromise = null;
      _dashboardInitialLoadStartedAt = 0;
    }, DASHBOARD_INITIAL_DEDUPE_MS);
  });
  return _dashboardInitialLoadPromise;
}



function formatInr(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatTxnAmount(amount, type) {
  const n = Number(amount);
  const mag = Math.abs(Number.isFinite(n) ? n : 0);
  const formatted = formatInr(mag);
  const t = String(type || "").toUpperCase();
  if (t === "DEBIT") return `−${formatted}`;
  if (t === "CREDIT") return `+${formatted}`;
  return formatted;
}

function mapApiTxnStatus(apiStatus) {
  const u = String(apiStatus || "").toUpperCase();
  if (u === "SUCCESS") return "Paid";
  if (u === "FAILED" || u === "FAILURE") return "Failed";
  if (u === "PENDING") return "Pending";
  if (!apiStatus) return "Pending";
  const s = String(apiStatus);
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatTxnDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rejectionMessage(reason, fallback) {
  if (reason && typeof reason === "object" && reason.message) {
    return String(reason.message);
  }
  if (reason instanceof Error) return reason.message;
  return fallback;
}

/**
 * Best-effort total count from tickets list API (shape varies by backend).
 * Returns null if no reliable total was found.
 */
function extractTicketsListTotal(payload) {
  if (payload == null) return null;
  const peeled = peelRepeatedApiEnvelope(payload);
  const { meta } = extractApiArrayAndMeta(payload);

  const candidates = [
    meta?.total,
    meta?.totalElements,
    meta?.totalItems,
    meta?.count,
    meta?.page?.totalElements,
    meta?.meta?.total,
    peeled && typeof peeled === "object" && !Array.isArray(peeled)
      ? /** @type {Record<string, unknown>} */ (peeled).total
      : undefined,
    peeled && typeof peeled === "object" && !Array.isArray(peeled)
      ? /** @type {Record<string, unknown>} */ (peeled).totalElements
      : undefined,
    peeled && typeof peeled === "object" && !Array.isArray(peeled)
      ? /** @type {Record<string, unknown>} */ (peeled).count
      : undefined,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** Recent ticket rows from list API (shape varies by backend). */
function extractTicketsListContent(payload) {
  const { items } = extractApiArrayAndMeta(payload);
  return items;
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ticketActivitySortAt(tk) {
  const raw = tk?.updatedAt ?? tk?.createdAt ?? tk?.date;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function mapTicketStatusForPill(raw) {
  const u = String(raw || "").toLowerCase();
  if (u === "open") return "Open";
  if (u === "failed") return "Failed";
  if (u === "pending" || u.includes("progress")) return "Pending";
  if (u === "resolved" || u === "closed") return "Paid";
  return "Pending";
}

function mapActivityApiRow(a, idx, pageIndex = 0) {
  const title =
    String(a?.title || a?.event || a?.action || a?.message || a?.description || "").trim() ||
    "Activity";
  const ts = a?.timestamp || a?.createdAt || a?.at || a?.time;
  const sortAt = ts ? new Date(ts).getTime() : 0;
  const time = ts ? formatTxnDate(ts) : "—";
  const type = String(a?.type || a?.category || "update").toLowerCase();
  let status = "info";
  if (type.includes("payment") || type.includes("success")) status = "Paid";
  else if (type.includes("login")) status = "Open";
  else if (type.includes("error") || type.includes("fail")) status = "Failed";
  return {
    key: `srv-act-${a?.id ?? `${pageIndex}-${idx}`}`,
    text: title,
    time,
    status,
    sortAt: Number.isFinite(sortAt) ? sortAt : 0,
  };
}

function normalizeActivityFeedPayload(payload) {
  if (payload == null) return [];
  const r = payload?.data !== undefined ? payload.data : payload;
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.content)) return r.content;
  if (Array.isArray(r?.items)) return r.items;
  return [];
}

function formatLastOpenedAt(iso) {
  if (!iso) return "—";
  return formatTxnDate(iso);
}

function mapRecentAppToGridEntry(row, i) {
  const palette = [
    { iconBg: "#eff6ff", iconColor: "#2563eb" },
    { iconBg: "#ecfdf5", iconColor: "#059669" },
    { iconBg: "#fff7ed", iconColor: "#ea580c" },
    { iconBg: "#f5f3ff", iconColor: "#7c3aed" },
    { iconBg: "#fef2f2", iconColor: "#dc2626" },
    { iconBg: "#ecfeff", iconColor: "#0891b2" },
  ];
  const p = palette[i % palette.length];
  return {
    key: `recent-${row.appId}-${i}`,
    appId: row.appId,
    name: row.appName,
    time: formatLastOpenedAt(row.lastOpenedAt),
    appUrl: row.appUrl,
    externalUrl: row.externalUrl,
    routePath: row.routePath,
    status: row.status,
    logoUrl: row.logoUrl,
    iconBg: p.iconBg,
    iconColor: p.iconColor,
  };
}

function downloadTransactionsCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const esc = (cell) => {
    const s = String(cell ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = ["Title", "DateTime", "Amount", "Status"];
  const lines = [
    header.join(","),
    ...rows.map((t) =>
      [esc(t.id), esc(t.time), esc(t.amount), esc(t.status)].join(","),
    ),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatLastUpdatedLabel(updatedAtMs) {
  if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 1000));
  if (sec < 60) {
    const unit = sec === 1 ? "sec" : "secs";
    return `Last updated ${sec} ${unit} ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    const unit = min === 1 ? "min" : "mins";
    return `Last updated ${min} ${unit} ago`;
  }
  const hr = Math.floor(min / 60);
  const unit = hr === 1 ? "hr" : "hrs";
  return `Last updated ${hr} ${unit} ago`;
}

function mapApiTransactionToListItem(row, index = 0) {
  const status = mapApiTxnStatus(row?.status);
  const failed = status === "Failed";
  const title =
    (row?.paymentDescription && String(row.paymentDescription).trim()) ||
    `Transaction #${row?.id ?? ""}`;
  const sortAt = row?.paymentDate
    ? new Date(row.paymentDate).getTime()
    : NaN;
  return {
    rowKey: `${row?.id ?? `idx-${index}`}-${row?.paymentDate ?? ""}`,
    id: title,
    time: formatTxnDate(row?.paymentDate),
    amount: formatTxnAmount(row?.amount, row?.type),
    status,
    sortAt: Number.isFinite(sortAt) ? sortAt : 0,
    iconBg: failed ? "#fff7ed" : "#eff6ff",
    iconColor: failed ? "#f97316" : "#3b82f6",
    _searchExtra: [row?.paymentMethod, row?.paymentSource, row?.type, row?.id]
      .filter(Boolean)
      .join(" "),
  };
}

function InvoiceIcon({ bg, color }) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: bg,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M8 7h8M8 11h8M8 15h4" />
      </svg>
    </div>
  );
}

function AppGridIcon({ bg, color }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: bg,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="8" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <rect x="13" y="13" width="8" height="8" rx="2" />
      </svg>
    </div>
  );
}

function ChartSkeleton({ matchUsageChartHeight = false }) {
  return (
    <div
      className={`ud-chart-wrap ud-chart-wrap--skeleton${
        matchUsageChartHeight ? " ud-chart-wrap--skeleton--usage-match" : ""
      }`}
      aria-hidden
    >
      <div className="ud-y-labels ud-y-labels--skeleton">
        <span className="ud-chart-sk-y" />
        <span className="ud-chart-sk-y" />
        <span className="ud-chart-sk-y" />
        <span className="ud-chart-sk-y" />
      </div>
      <div className="ud-chart-body ud-chart-body--skeleton">
        <div className="ud-chart-skeleton-bars">
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={`csk-${i}`}
              className="ud-chart-skeleton-bar"
              style={{ animationDelay: `${i * 0.07}s` }}
            />
          ))}
        </div>
        <div className="ud-x-labels ud-x-labels--skeleton">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={`xsk-${i}`} className="ud-chart-sk-x" />
          ))}
        </div>
      </div>
    </div>
  );
}

function TxnListSkeletonRows({ count = 6 }) {
  return Array.from({ length: count }, (_, i) => (
    <li
      key={`txn-sk-${i}`}
      className="ud-txn-item ud-txn-item--skeleton"
      aria-busy="true"
    >
      <div className="ud-txn-sk-icon" />
      <div className="ud-txn-sk-col">
        <span className="ud-txn-sk-line ud-txn-sk-line--wide" />
        <span className="ud-txn-sk-line ud-txn-sk-line--narrow" />
      </div>
      <div className="ud-txn-sk-side">
        <span className="ud-txn-sk-line ud-txn-sk-line--amt" />
        <span className="ud-txn-sk-pill" />
      </div>
    </li>
  ));
}

function ActivitySkeletonRows({ count = 6 }) {
  return Array.from({ length: count }, (_, i) => (
    <li
      key={`ra-sk-${i}`}
      className="ud-ra-item ud-ra-item--skeleton"
      aria-busy="true"
    >
      <span className="ud-act-dot ud-act-dot--skeleton" />
      <div className="ud-ra-body ud-ra-body--skeleton">
        <span className="ud-ra-sk-line ud-ra-sk-line--long" />
      </div>
      <span className="ud-ra-sk-line ud-ra-sk-line--time" />
    </li>
  ));
}

function NotificationSkeletonRows({ count = 4 }) {
  return Array.from({ length: count }, (_, i) => (
    <div
      key={`ud-notif-sk-${i}`}
      className="ud-notif-item ud-notif-item--skeleton"
      aria-busy="true"
      aria-hidden
    >
      <span className="ud-notif-sk-dot" />
      <div className="ud-notif-sk-body">
        <span className="ud-notif-sk-line ud-notif-sk-line--long" />
        <span className="ud-notif-sk-line ud-notif-sk-line--short" />
      </div>
    </div>
  ));
}

function AppsGridSkeleton() {
  return Array.from({ length: 6 }, (_, i) => (
    <div
      key={`app-sk-${i}`}
      className="ud-app-entry ud-app-entry--skeleton"
      aria-busy="true"
    >
      <div className="ud-app-sk-icon" />
      <div className="ud-app-sk-meta">
        <span className="ud-app-sk-line ud-app-sk-line--title" />
        <span className="ud-app-sk-line ud-app-sk-line--sub" />
      </div>
      <span className="ud-app-sk-btn" />
    </div>
  ));
}

export default function UserDashboard() {
  const [search, setSearch] = useState("");
  const [catalogApps, setCatalogApps] = useState([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchContainerRef = useRef(null);
  const [whatsNewItems, setWhatsNewItems] = useState([]);
  const [whatsNewLoading, setWhatsNewLoading] = useState(false);
  const [whatsNewError, setWhatsNewError] = useState("");
  const [serverActivity, setServerActivity] = useState([]);
  const { profile, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [transactionsPage, setTransactionsPage] = useState(0);
  const [transactionsTotalPages, setTransactionsTotalPages] = useState(1);
  const [transactionsTotalElements, setTransactionsTotalElements] = useState(0);
  const [transactionsLastPage, setTransactionsLastPage] = useState(true);
  const [transactionsPageLoading, setTransactionsPageLoading] = useState(false);
  const [ticketsListTotal, setTicketsListTotal] = useState(null);
  const [recentTickets, setRecentTickets] = useState([]);
  const [dashboardRefreshing, setDashboardRefreshing] = useState(true);
  const [initialDashboardLoadDone, setInitialDashboardLoadDone] =
    useState(false);
  const [sectionErrors, setSectionErrors] = useState({
    summary: "",
    transactions: "",
    tickets: "",
    activity: "",
    recentApps: "",
  });
  const [recentAppsRaw, setRecentAppsRaw] = useState([]);
  const [myAppsUsageOptions, setMyAppsUsageOptions] = useState([]);
  const [catalogFromList, setCatalogFromList] = useState(0);
  const [usageRange, setUsageRange] = useState("7d");
  const [selectedUsageAppId, setSelectedUsageAppId] = useState("");
  const [usageSeriesRows, setUsageSeriesRows] = useState([]);
  const [usageChartError, setUsageChartError] = useState("");
  const [usageChartLoading, setUsageChartLoading] = useState(false);
  const [usageChartRetrying, setUsageChartRetrying] = useState(false);
  const [usageAppPickerOpen, setUsageAppPickerOpen] = useState(false);
  const [usagePrefetchEngaged, setUsagePrefetchEngaged] = useState(false);
  /** Bumped when dashboard force-refresh clears usage cache so chart refetches (deps otherwise unchanged). */
  const [usageFetchVersion, setUsageFetchVersion] = useState(0);
  const usageDataCacheRef = useRef(getUsageTimeseriesCache());
  const usageAppPickerRef = useRef(null);
  const appUsageBlockRef = useRef(null);
  const usageFetchGenRef = useRef(0);
  const prevUsagePrefetchTokenRef = useRef(token);
  const [lastDashboardUpdatedAt, setLastDashboardUpdatedAt] = useState(null);
  const [lastUpdatedTick, setLastUpdatedTick] = useState(0);
  const [bundleRetrying, setBundleRetrying] = useState(false);
  const [txnRetrying, setTxnRetrying] = useState(false);
  const dashboardRequestIdRef = useRef(0);
  const bundleRetryWaveRef = useRef(false);
  const initialDashboardLoadDoneRef = useRef(false);
  const lastCatalogCountRef = useRef(0);
  const query = search.trim().toLowerCase();


  const loadDashboardData = useCallback(async (options = {}) => {
    const { silent = false, force = false } = options;
    const requestId = ++dashboardRequestIdRef.current;
    const isRefresh = initialDashboardLoadDoneRef.current;
    bundleRetryWaveRef.current = false;
    setBundleRetrying(false);
    setDashboardRefreshing(true);
    if (!isRefresh) {
      setTicketsListTotal(null);
      setRecentTickets([]);
      setServerActivity([]);
    }

    const onBundleRetrying = () => {
      if (!bundleRetryWaveRef.current) {
        bundleRetryWaveRef.current = true;
        setBundleRetrying(true);
      }
    };

    const wrap = (fn) => withRetryOnce(fn, { onRetrying: onBundleRetrying });

    const cachedRecentPayload = !force ? readRecentAppsCache(token) : null;
    const recentP =
      cachedRecentPayload != null
        ? null
        : (async () => {
            try {
              const value = await wrap(() =>
                dashboardBackend.getRecentApps(DASHBOARD_API_QUIET),
              );
              writeRecentAppsCache(token, value);
              return { status: "fulfilled", value };
            } catch (reason) {
              return { status: "rejected", reason };
            }
          })();

    const catalogP = (async () => {
      try {
        const value = await wrap(() =>
          applicationBackend.list({ ...DASHBOARD_API_QUIET, size: 100 }),
        );
        return { status: "fulfilled", value };
      } catch (reason) {
        return { status: "rejected", reason };
      }
    })();

    const myAppsUsageP = (async () => {
      try {
        const value = await wrap(() => applicationBackend.my(DASHBOARD_API_QUIET));
        return { status: "fulfilled", value };
      } catch (reason) {
        return { status: "rejected", reason };
      }
    })();

    if (force) {
      usageDataCacheRef.current.clear();
      setUsageFetchVersion((v) => v + 1);
    }

    let results = null;
    if (!isRefresh && !force) {
      results = readDashboardBundleCache(token);
    }

    if (!results) {
      results =
        IS_DEV && !isRefresh
          ? await getInitialDashboardBundleDeduped(onBundleRetrying)
          : await fetchDashboardInitialBundleFromNetwork(onBundleRetrying);
      writeDashboardBundleCacheIfComplete(token, results);
    }

    if (requestId !== dashboardRequestIdRef.current) {
      bundleRetryWaveRef.current = false;
      setBundleRetrying(false);
      setDashboardRefreshing(false);
      return;
    }

    const recentR =
      cachedRecentPayload != null
        ? { status: "fulfilled", value: cachedRecentPayload }
        : await recentP;

    const [catalogR, myAppsUsageR] = await Promise.all([catalogP, myAppsUsageP]);

    if (requestId !== dashboardRequestIdRef.current) {
      bundleRetryWaveRef.current = false;
      setBundleRetrying(false);
      setDashboardRefreshing(false);
      return;
    }

    if (DEBUG_DASHBOARD && recentR.status === "fulfilled") {
      // eslint-disable-next-line no-console
      console.log("Recent Apps API response:", recentR.value);
    }

    if (requestId !== dashboardRequestIdRef.current) {
      bundleRetryWaveRef.current = false;
      setBundleRetrying(false);
      setDashboardRefreshing(false);
      return;
    }

    const [summaryR, txnR, ticketsR, activityR] = results;

    const nextSectionErrors = {
      summary:
        summaryR.status === "fulfilled"
          ? ""
          : rejectionMessage(
              summaryR.reason,
              "Could not load dashboard summary.",
            ),
      transactions:
        txnR.status === "fulfilled"
          ? ""
          : rejectionMessage(txnR.reason, "Could not load transactions."),
      tickets:
        ticketsR.status === "fulfilled"
          ? ""
          : rejectionMessage(ticketsR.reason, "Could not load ticket count."),
      activity:
        activityR.status === "fulfilled"
          ? ""
          : rejectionMessage(activityR.reason, "Could not load activity feed."),
      recentApps:
        recentR.status === "fulfilled"
          ? ""
          : rejectionMessage(
              recentR.reason,
              "Could not load recently accessed apps.",
            ),
    };
    setSectionErrors(nextSectionErrors);

    if (recentR.status === "fulfilled") {
      setRecentAppsRaw(normalizeRecentAppsPayload(recentR.value, { limit: 6 }));
    } else if (!silent && !isRefresh) {
      setRecentAppsRaw([]);
    }

    const nextCatalogFromList =
      catalogR.status === "fulfilled"
        ? catalogCountFromListResponse(catalogR.value)
        : lastCatalogCountRef.current;
    if (catalogR.status === "fulfilled" && nextCatalogFromList > 0) {
      lastCatalogCountRef.current = nextCatalogFromList;
    }
    setCatalogFromList(nextCatalogFromList);

    if (catalogR.status === "fulfilled") {
      const listVal = catalogR.value;
      const rawList = Array.isArray(listVal)
        ? listVal
        : Array.isArray(listVal?.data)
        ? listVal.data
        : Array.isArray(listVal?.content)
        ? listVal.content
        : Array.isArray(listVal?.applications)
        ? listVal.applications
        : Array.isArray(listVal?.apps)
        ? listVal.apps
        : [];
      setCatalogApps(rawList.slice(0, 100));
    } else if (!silent && !isRefresh) {
      setCatalogApps([]);
    }

    if (myAppsUsageR.status === "fulfilled") {
      setMyAppsUsageOptions(normalizeMyAppsUsageOptions(myAppsUsageR.value));
    } else if (!silent && !isRefresh) {
      setMyAppsUsageOptions([]);
    }

    if (summaryR.status === "fulfilled") {
      const body = summaryR.value;
      setSummary(
        dashboardSummaryNormalize(body, { catalogFromList: nextCatalogFromList }),
      );
    } else if (!isRefresh) {
      setSummary(null);
    }

    if (txnR.status === "fulfilled") {
      const page = normalizeDashboardTxnPage(txnR.value);
      const content = page.content;
      setTransactionsPage(Number(page.number) || 0);
      setTransactionsTotalPages(page.totalPages);
      setTransactionsTotalElements(page.totalElements);
      setTransactionsLastPage(page.last);
      setTransactions(
        content.map((row, i) => mapApiTransactionToListItem(row, i)),
      );
    } else if (!isRefresh) {
      setTransactions([]);
      setTransactionsPage(0);
      setTransactionsTotalPages(1);
      setTransactionsTotalElements(0);
      setTransactionsLastPage(true);
    }

    if (ticketsR.status === "fulfilled") {
      const extracted = extractTicketsListTotal(ticketsR.value);
      setTicketsListTotal(extracted);
      setRecentTickets(extractTicketsListContent(ticketsR.value));
    } else if (!isRefresh) {
      setTicketsListTotal(null);
      setRecentTickets([]);
    }

    if (activityR.status === "fulfilled") {
      const rawList = normalizeActivityFeedPayload(activityR.value);
      setServerActivity(
        rawList.map((row, idx) => mapActivityApiRow(row, idx, 0)),
      );
    } else if (!isRefresh) {
      setServerActivity([]);
    }

    if (requestId !== dashboardRequestIdRef.current) {
      bundleRetryWaveRef.current = false;
      setBundleRetrying(false);
      setDashboardRefreshing(false);
      return;
    }

    const anySectionFailed = Object.values(nextSectionErrors).some(Boolean);
    const coreDataOk =
      summaryR.status === "fulfilled" || txnR.status === "fulfilled";

    if (isRefresh && !anySectionFailed && !silent) {
      showSuccess("Dashboard refreshed");
    }

    if (coreDataOk) {
      setLastDashboardUpdatedAt(Date.now());
    }

    if (!initialDashboardLoadDoneRef.current) {
      initialDashboardLoadDoneRef.current = true;
      setInitialDashboardLoadDone(true);
    }
    bundleRetryWaveRef.current = false;
    setBundleRetrying(false);
    setDashboardRefreshing(false);
  }, [token]);

  const loadTransactionsPage = useCallback(async (nextPage) => {
    const pageIndex = Math.max(0, Number(nextPage) || 0);
    const requestId = ++dashboardRequestIdRef.current;
    setTransactionsPageLoading(true);
    setTxnRetrying(false);
    setSectionErrors((prev) => ({ ...prev, transactions: "" }));

    try {
      const raw = await withRetryOnce(
        () =>
          dashboardApi.getTransactions(
            pageIndex,
            DASHBOARD_TXN_PAGE_SIZE,
            DASHBOARD_API_QUIET,
          ),
        { onRetrying: () => setTxnRetrying(true) },
      );
      if (requestId !== dashboardRequestIdRef.current) return;
      const page = normalizeDashboardTxnPage(raw);
      const content = page.content;
      setTransactionsPage(pageIndex);
      setTransactionsTotalPages(page.totalPages);
      setTransactionsTotalElements(page.totalElements);
      setTransactionsLastPage(page.last);
      setTransactions(
        content.map((row, i) => mapApiTransactionToListItem(row, i)),
      );
    } catch (err) {
      if (requestId !== dashboardRequestIdRef.current) return;
      setSectionErrors((prev) => ({
        ...prev,
        transactions: rejectionMessage(err, "Could not load transactions."),
      }));
    } finally {
      if (requestId === dashboardRequestIdRef.current) {
        setTxnRetrying(false);
        setTransactionsPageLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWhatsNewLoading(true);
    announcementsApi
      .listActive()
      .then((rows) => {
        if (cancelled) return;
        setWhatsNewItems(
          rows
            .map(announcementWhatsNewItem)
            .filter(Boolean),
        );
        setWhatsNewError("");
      })
      .catch((e) => {
        if (cancelled) return;
        setWhatsNewItems([]);
        setWhatsNewError(e?.message || "Could not load announcements.");
      })
      .finally(() => {
        if (!cancelled) setWhatsNewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadDashboardData();
    return () => {
      dashboardRequestIdRef.current += 1;
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const onInvalidate = () => {
      void loadDashboardData({ silent: true, force: true });
    };
    window.addEventListener(DASHBOARD_INVALIDATE_EVENT, onInvalidate);
    return () => window.removeEventListener(DASHBOARD_INVALIDATE_EVENT, onInvalidate);
  }, [loadDashboardData]);

  useEffect(() => {
    const refresh = () => void loadDashboardData({ silent: true, force: true });
    const offCatalog = onAppsCatalogChanged(refresh);
    const offMyApps = onMyAppsChanged(refresh);
    return () => {
      offCatalog();
      offMyApps();
    };
  }, [loadDashboardData]);

  useEffect(() => {
    if (lastDashboardUpdatedAt == null) return undefined;
    const id = window.setInterval(
      () => setLastUpdatedTick((n) => n + 1),
      1000,
    );
    return () => clearInterval(id);
  }, [lastDashboardUpdatedAt]);

  useEffect(() => {
    if (!DASHBOARD_AUTOREFRESH_ENABLED || !initialDashboardLoadDone) {
      return undefined;
    }

    let intervalId = null;

    const clearPoll = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startPollIfVisible = () => {
      clearPoll();
      if (document.visibilityState !== "visible") return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          loadDashboardData({ silent: true });
        }
      }, DASHBOARD_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearPoll();
      } else {
        startPollIfVisible();
        void loadDashboardData({ silent: true });
      }
    };

    startPollIfVisible();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearPoll();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [initialDashboardLoadDone, loadDashboardData]);

  const showDashboardSkeleton =
    dashboardRefreshing && !initialDashboardLoadDone;
  const showRetrySpinner =
    dashboardRefreshing && initialDashboardLoadDone;
  const showTxnSkeleton = showDashboardSkeleton || transactionsPageLoading;

  const lastUpdatedLabel = useMemo(
    () => formatLastUpdatedLabel(lastDashboardUpdatedAt),
    [lastDashboardUpdatedAt, lastUpdatedTick],
  );

  const hasAnySectionError = useMemo(
    () => Object.values(sectionErrors).some(Boolean),
    [sectionErrors],
  );

  const summaryLoadFailed = Boolean(sectionErrors.summary);
  const totalApps =
    Number(summary?.totalCatalogApps ?? summary?.catalogAppsCount ?? catalogFromList ?? summary?.totalApps) || 0;
  const activeSubscriptions = Number(summary?.activeSubscriptions) || 0;
  const totalTransactions = Number(summary?.totalTransactions ?? 0) || 0;
  const referralCount = Number(summary?.referralCount ?? 0) || 0;
  const totalSpent = Number(summary?.totalSpent ?? 0) || 0;
  const kycDashboardCanon =
    typeof canonicalizeKycStatus === "function"
      ? canonicalizeKycStatus(summary?.kycStatus)
      : KYC_CANONICAL?.PENDING ?? "PENDING";
  const kycDashboardLabel =
    typeof kycCanonicalLabel === "function"
      ? kycCanonicalLabel(kycDashboardCanon)
      : "Pending";
  const kycDashboardVerified =
    kycDashboardCanon === (KYC_CANONICAL && KYC_CANONICAL.VERIFIED);
  const ticketsKpiCount = useMemo(() => {
    if (sectionErrors.tickets) return null;

    if (ticketsListTotal !== null && ticketsListTotal !== undefined) {
      const n = Number(ticketsListTotal);
      if (Number.isFinite(n) && n >= 0) return n;
    }

    const fromSummary = Number(summary?.ticketCount ?? summary?.openTickets);
    if (Number.isFinite(fromSummary) && fromSummary >= 0) return fromSummary;

    if (Array.isArray(recentTickets) && recentTickets.length > 0) {
      return recentTickets.length;
    }

    return null;
  }, [ticketsListTotal, recentTickets, summary, sectionErrors.tickets]);

  const activityItems = useMemo(() => {
    if (Array.isArray(serverActivity) && serverActivity.length > 0) {
      return [...serverActivity].sort((a, b) => b.sortAt - a.sortAt).slice(0, 14);
    }
    const fromTx = transactions.map((txn) => ({
      key: `tx-${txn.rowKey}`,
      text: txn.id,
      time: txn.time,
      status: txn.status,
      sortAt: txn.sortAt || 0,
    }));
    const fromTk = recentTickets.map((tk, i) => {
      const subj = String(tk?.subject || tk?.title || "Ticket").trim();
      const short = subj.length > 72 ? `${subj.slice(0, 72)}…` : subj;
      const st = ticketActivitySortAt(tk);
      return {
        key: `tk-${tk?.id ?? i}-${st}`,
        text: `Ticket · ${short}`,
        time: formatTxnDate(tk?.updatedAt ?? tk?.createdAt ?? tk?.date ?? null),
        status: mapTicketStatusForPill(tk?.status),
        sortAt: st,
      };
    });
    return [...fromTx, ...fromTk]
      .sort((a, b) => b.sortAt - a.sortAt)
      .slice(0, 14);
  }, [serverActivity, transactions, recentTickets]);

  const recentAppsForGrid = useMemo(() => {
    const rows = recentAppsRaw.map((r, i) => mapRecentAppToGridEntry(r, i));
    if (!query) return rows;
    return rows.filter((app) =>
      `${app.name} ${app.time}`.toLowerCase().includes(query),
    );
  }, [recentAppsRaw, query]);

  const usageAppOptions = useMemo(() => {
    const palette = [
      { iconBg: "#eff6ff", iconColor: "#2563eb" },
      { iconBg: "#ecfdf5", iconColor: "#059669" },
      { iconBg: "#fff7ed", iconColor: "#ea580c" },
      { iconBg: "#f5f3ff", iconColor: "#7c3aed" },
      { iconBg: "#fef2f2", iconColor: "#dc2626" },
      { iconBg: "#ecfeff", iconColor: "#0891b2" },
    ];
    const byId = new Map();
    let i = 0;
    for (const r of recentAppsRaw) {
      const appId = String(r.appId);
      if (byId.has(appId)) continue;
      const p = palette[i % palette.length];
      byId.set(appId, {
        appId,
        label: r.appName,
        logoUrl: r.logoUrl,
        iconBg: p.iconBg,
        iconColor: p.iconColor,
      });
      i += 1;
    }
    for (const r of myAppsUsageOptions) {
      const appId = String(r.appId);
      if (byId.has(appId)) continue;
      const p = palette[i % palette.length];
      byId.set(appId, {
        appId,
        label: r.label,
        logoUrl: r.logoUrl,
        iconBg: p.iconBg,
        iconColor: p.iconColor,
      });
      i += 1;
    }
    return Array.from(byId.values());
  }, [recentAppsRaw, myAppsUsageOptions]);

  const selectedUsageAppOption = useMemo(
    () => usageAppOptions.find((o) => o.appId === selectedUsageAppId) ?? null,
    [usageAppOptions, selectedUsageAppId],
  );

  const selectedUsageAppLabel = useMemo(
    () => selectedUsageAppOption?.label?.trim() || "App",
    [selectedUsageAppOption],
  );

  const engageUsagePrefetch = useCallback(() => {
    setUsagePrefetchEngaged((v) => (v ? v : true));
  }, []);

  useEffect(() => {
    if (showDashboardSkeleton || !initialDashboardLoadDone || usagePrefetchEngaged) {
      return undefined;
    }
    const el = appUsageBlockRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setUsagePrefetchEngaged(true);
        }
      },
      { threshold: 0.08, rootMargin: "0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showDashboardSkeleton, initialDashboardLoadDone, usagePrefetchEngaged]);

  useEffect(() => {
    if (!usageAppPickerOpen) return undefined;
    const onDown = (e) => {
      if (
        usageAppPickerRef.current &&
        !usageAppPickerRef.current.contains(e.target)
      ) {
        setUsageAppPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [usageAppPickerOpen]);

  useEffect(() => {
    if (usageAppOptions.length === 0) {
      if (selectedUsageAppId) setSelectedUsageAppId("");
      return;
    }
    const ok = usageAppOptions.some((o) => o.appId === selectedUsageAppId);
    if (ok) return;
    let preferred = "";
    try {
      preferred = String(
        window.localStorage.getItem(USAGE_APP_STORAGE_KEY) || "",
      ).trim();
    } catch {
      preferred = "";
    }
    const okPreferred =
      preferred && usageAppOptions.some((o) => o.appId === preferred);
    setSelectedUsageAppId(
      okPreferred ? preferred : usageAppOptions[0].appId,
    );
  }, [usageAppOptions, selectedUsageAppId]);

  const firstRecentAppId = useMemo(
    () => (recentAppsRaw.length ? String(recentAppsRaw[0].appId) : ""),
    [recentAppsRaw],
  );

  useEffect(() => {
    if (prevUsagePrefetchTokenRef.current !== token) {
      prevUsagePrefetchTokenRef.current = token;
      setUsagePrefetchEngaged(false);
    }
  }, [token]);

  useEffect(() => {
    if (!usagePrefetchEngaged || !firstRecentAppId) return undefined;
    const range = "7d";
    const cacheKey = `${firstRecentAppId}\t${range}`;
    if (usageDataCacheRef.current.get(cacheKey)) return undefined;
    const inflightKey = usageInflightRequestKey(firstRecentAppId, range);
    const interval = usageIntervalForRange(range);
    const granularity = interval === "hour" ? "hour" : "day";
    void coalesceUsageTimeseriesFetch(inflightKey, () =>
      withRetryOnce(() =>
        dashboardBackend.getAppUsageTimeseries(
          firstRecentAppId,
          range,
          interval,
          DASHBOARD_API_QUIET,
        ),
      ),
    )
      .then((body) => {
        if (usageDataCacheRef.current.get(cacheKey)) return;
        const normalized = normalizeUsageTimeseriesPayload(body, granularity, range);
        if (normalized.length > 0) {
          usageDataCacheRef.current.set(cacheKey, normalized);
        }
      })
      .catch(() => {});
    return undefined;
  }, [firstRecentAppId, usagePrefetchEngaged]);

  useEffect(() => {
    if (!selectedUsageAppId) {
      setUsageSeriesRows([]);
      setUsageChartError("");
      setUsageChartLoading(false);
      setUsageChartRetrying(false);
      return undefined;
    }
    const interval = usageIntervalForRange(usageRange);
    const granularity = interval === "hour" ? "hour" : "day";
    const cacheKey = `${selectedUsageAppId}\t${usageRange}`;
    const cached = usageDataCacheRef.current.get(cacheKey);
    // Do not reuse cached empty series — bad unwrap used to poison cache and skip refetch.
    if (cached && cached.length > 0) {
      setUsageSeriesRows(cached);
      setUsageChartError("");
      setUsageChartLoading(false);
      setUsageChartRetrying(false);
      return undefined;
    }

    const gen = ++usageFetchGenRef.current;
    const inflightKey = usageInflightRequestKey(selectedUsageAppId, usageRange);
    setUsageChartLoading(true);
    setUsageChartError("");
    setUsageChartRetrying(false);

    void coalesceUsageTimeseriesFetch(inflightKey, () =>
      withRetryOnce(
        () =>
          dashboardBackend.getAppUsageTimeseries(
            selectedUsageAppId,
            usageRange,
            interval,
            DASHBOARD_API_QUIET,
          ),
        {
          onRetrying: () => setUsageChartRetrying(true),
        },
      ),
    )
      .then((body) => {
        if (DEBUG_DASHBOARD && gen === usageFetchGenRef.current) {
          // eslint-disable-next-line no-console
          console.log("Usage API response:", body);
        }
        if (gen !== usageFetchGenRef.current) return;
        const normalized = normalizeUsageTimeseriesPayload(
          body,
          granularity,
          usageRange,
        );
        if (normalized.length > 0) {
          usageDataCacheRef.current.set(cacheKey, normalized);
        }
        setUsageSeriesRows(normalized);
        setUsageChartError("");
      })
      .catch((err) => {
        if (gen !== usageFetchGenRef.current) return;
        setUsageChartError(
          rejectionMessage(err, "Could not load app usage analytics."),
        );
        setUsageSeriesRows([]);
      })
      .finally(() => {
        if (gen !== usageFetchGenRef.current) return;
        setUsageChartLoading(false);
        setUsageChartRetrying(false);
      });

    return undefined;
  }, [selectedUsageAppId, usageRange, usageFetchVersion]);

  const NAVIGATION_TARGETS = useMemo(() => [
    { type: "Navigation", label: "Dashboard Overview", subtitle: "Main overview of account status and usage statistics", route: "/dashboard" },
    { type: "Navigation", label: "All Application Catalog", subtitle: "Browse and subscribe to available applications", route: "/all-apps" },
    { type: "Navigation", label: "My Subscribed Applications", subtitle: "Launch your active and subscribed services", route: "/my-apps" },
    { type: "Navigation", label: "Favorite Applications", subtitle: "Quick access to your starred applications", route: "/favorites" },
    { type: "Navigation", label: "User Profile", subtitle: "View and edit personal details and verification status", route: "/profile" },
    { type: "Navigation", label: "Account Settings", subtitle: "Configure notification settings, system preferences, and security", route: "/settings" },
    { type: "Navigation", label: "Audit Log & Activity Feed", subtitle: "Trace history of all transactions, logins, and service actions", route: "/activity" },
    { type: "Navigation", label: "Support Ticket Center", subtitle: "View recent queries, active tickets, and chat with agents", route: "/tickets" },
    { type: "Navigation", label: "Submit New Ticket", subtitle: "Open a support query or request system changes", route: "/support/ticket" }
  ], []);

  const searchSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    const suggestions = [];

    // 1. Apps
    const matchedApps = catalogApps
      .filter(app => {
        const name = (app?.appName ?? app?.name ?? "").toLowerCase();
        const desc = (app?.description ?? app?.detail ?? "").toLowerCase();
        return name.includes(q) || desc.includes(q);
      })
      .slice(0, 5)
      .map(app => ({
        type: "Apps",
        label: app?.appName ?? app?.name ?? "App",
        subtitle: app?.description ?? app?.detail ?? "",
        route: app?.routePath ?? app?.route ?? `/all-apps`
      }));
    suggestions.push(...matchedApps);

    // 2. Tickets
    const matchedTickets = recentTickets
      .filter(t => {
        const id = String(t?.id ?? "").toLowerCase();
        const subj = (t?.subject ?? t?.title ?? "").toLowerCase();
        const desc = (t?.description ?? "").toLowerCase();
        return id.includes(q) || subj.includes(q) || desc.includes(q);
      })
      .slice(0, 5)
      .map(t => ({
        type: "Tickets",
        label: t?.subject ?? t?.title ?? `Ticket #${t?.id}`,
        subtitle: `Status: ${t?.status || "Open"} • #${t?.id}`,
        route: `/support/ticket/${t?.id}`
      }));
    suggestions.push(...matchedTickets);

    // 3. Transactions
    const matchedTxns = transactions
      .filter(t => {
        const id = String(t?.id ?? "").toLowerCase();
        const desc = (t?._searchExtra ?? "").toLowerCase();
        const status = (t?.status ?? "").toLowerCase();
        const amount = (t?.amount ?? "").toLowerCase();
        return id.includes(q) || desc.includes(q) || status.includes(q) || amount.includes(q);
      })
      .slice(0, 5)
      .map(t => ({
        type: "Transactions",
        label: t?.id || "Transaction",
        subtitle: `${t?.amount || ""} • Status: ${t?.status || "Pending"} • ${t?.time || ""}`,
        route: "/activity"
      }));
    suggestions.push(...matchedTxns);

    // 4. Navigation
    const matchedNav = NAVIGATION_TARGETS.filter(n => {
      return n.label.toLowerCase().includes(q) || n.subtitle.toLowerCase().includes(q);
    });
    suggestions.push(...matchedNav);

    // 5. Referrals
    const referralTerms = ["refer", "referral", "invite", "share", "bonus", "commission", "code"];
    if (referralTerms.some(t => q.includes(t))) {
      suggestions.push({
        type: "Referrals",
        label: "Referrals Program",
        subtitle: "Invite friends, track status, and earn rewards",
        route: "/profile"
      });
    }

    // 6. Dashboard Modules
    const MODULES = [
      { type: "Navigation", label: "App Usage Analytics", subtitle: "Analyze application usage logs and timeseries data", route: "/dashboard" },
      { type: "Navigation", label: "Transaction History", subtitle: "Export invoices and view past debit/credit payments", route: "/dashboard" },
      { type: "Navigation", label: "Announcements & What's New", subtitle: "Stay updated with company announcements and new features", route: "/dashboard" }
    ];
    const matchedModules = MODULES.filter(m => {
      return m.label.toLowerCase().includes(q) || m.subtitle.toLowerCase().includes(q);
    });
    suggestions.push(...matchedModules);

    return suggestions;
  }, [search, catalogApps, recentTickets, transactions, NAVIGATION_TARGETS]);

  const groupedSuggestions = useMemo(() => {
    const groups = {};
    searchSuggestions.forEach((item, index) => {
      if (!groups[item.type]) {
        groups[item.type] = [];
      }
      groups[item.type].push({ ...item, flatIndex: index });
    });
    return groups;
  }, [searchSuggestions]);

  const getCategoryColor = (type) => {
    const map = {
      Apps: "#3b82f6",
      Tickets: "#ea580c",
      Transactions: "#059669",
      Navigation: "#7c3aed",
      Referrals: "#ec4899"
    };
    return map[type] || "#64748b";
  };

  const executeSearch = () => {
    const active = highlightedIndex >= 0 && highlightedIndex < searchSuggestions.length
      ? searchSuggestions[highlightedIndex]
      : searchSuggestions[0];
    if (active) {
      navigate(active.route);
      setSearch("");
      setShowSearchDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  const handleSuggestionClick = (route) => {
    navigate(route);
    setSearch("");
    setShowSearchDropdown(false);
    setHighlightedIndex(-1);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        searchSuggestions.length > 0 ? (prev + 1) % searchSuggestions.length : -1
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        searchSuggestions.length > 0
          ? (prev - 1 + searchSuggestions.length) % searchSuggestions.length
          : -1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeSearch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSearchDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredTransactions = query
    ? transactions.filter((item) =>
        `${item.id} ${item.time} ${item.amount} ${item.status} ${item._searchExtra || ""}`
          .toLowerCase()
          .includes(query),
      )
    : transactions;

  const filteredActivity = useMemo(() => {
    if (!query) return activityItems;
    return activityItems.filter((item) =>
      `${item.text} ${item.time} ${item.status || ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [activityItems, query]);

  const handleExportTransactionsCsv = useCallback(() => {
    if (filteredTransactions.length === 0) return;
    downloadTransactionsCsv(filteredTransactions);
    showSuccess("CSV exported (visible rows only)");
  }, [filteredTransactions]);


  return (
    <div className="ud-page">



      {/* ── DASHBOARD GREETING BAR ── */}
      <div className="ud-top-bar">
        <div className="ud-greeting">
          <h1>
            Good Morning, {getGreetingFirstName(profile) || "there"} 👋
          </h1>
          <p>Here's a quick overview of your account.</p>
          {bundleRetrying ? (
            <p className="ud-dash-retrying" role="status">
              Retrying…
            </p>
          ) : null}
          {lastUpdatedLabel ? (
            <p className="ud-dash-last-updated">{lastUpdatedLabel}</p>
          ) : null}
          {hasAnySectionError ? (
            <div className="ud-dash-error-row">
              <p className="ud-dash-partial-hint">
                Some sections could not load. Details appear on each card below.
              </p>
              <button
                type="button"
                className="ud-btn-outline ud-dash-retry-btn"
                onClick={() => loadDashboardData({ silent: false, force: true })}
                disabled={dashboardRefreshing}
              >
                {showRetrySpinner ? (
                  <span className="ud-dash-retry-spinner" aria-hidden />
                ) : null}
                Retry all
              </button>
            </div>
          ) : null}
        </div>
        <div className="ud-search-wrap" ref={searchContainerRef}>
          <svg
            className="ud-si"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9ca3af"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ cursor: "pointer" }}
            onClick={() => executeSearch()}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="ud-search-field"
            placeholder="Search apps, subscriptions, tickets, invoices..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowSearchDropdown(true);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setShowSearchDropdown(true)}
            onKeyDown={handleSearchKeyDown}
          />
          {showSearchDropdown && searchSuggestions.length > 0 && (
            <div className="ud-search-dropdown">
              {["Apps", "Tickets", "Transactions", "Navigation", "Referrals"].map(cat => {
                const items = groupedSuggestions[cat];
                if (!items || items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="ud-search-section-title">{cat}</div>
                    {items.map(item => (
                      <button
                        key={`${item.type}-${item.label}-${item.flatIndex}`}
                        type="button"
                        className={`ud-search-item ${item.flatIndex === highlightedIndex ? "ud-search-item--active" : ""}`}
                        onClick={() => handleSuggestionClick(item.route)}
                        onMouseEnter={() => setHighlightedIndex(item.flatIndex)}
                      >
                        <span
                          className="ud-search-item-icon"
                          style={{ background: getCategoryColor(item.type) }}
                        >
                          {item.type.slice(0, 1)}
                        </span>
                        <div>
                          <span className="ud-search-item-label">{item.label}</span>
                          <span className="ud-search-item-subtitle">{item.subtitle}</span>
                        </div>
                        <span className="ud-search-item-type">{item.type}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── BODY BENTO GRID ── */}
      <div className="ud-body ud-body--bento">
        <div
          className={`ud-stats-strip ud-bento-kpi${showDashboardSkeleton ? " ud-stats-strip--loading" : ""}`}
          aria-busy={showDashboardSkeleton || dashboardRefreshing}
        >
            <button
              className="ud-stat ud-stat-action"
              type="button"
              onClick={() => navigate("/all-apps")}
            >
              <p>
                {showDashboardSkeleton ? (
                  <span className="ud-stat-skeleton-line" />
                ) : (
                  "All Apps"
                )}
              </p>
              <h2>
                {showDashboardSkeleton ? (
                  <span className="ud-stat-skeleton-line ud-stat-skeleton-line--value" />
                ) : summaryLoadFailed ? (
                  <span className="ud-stat-kpi-na" title={sectionErrors.summary}>
                    —
                  </span>
                ) : (
                  `${totalApps} ${totalApps === 1 ? "App" : "Apps"}`
                )}
              </h2>
            </button>
            <button
              className="ud-stat ud-stat-action"
              type="button"
              onClick={() => navigate("/my-apps")}
            >
              <p>
                {showDashboardSkeleton ? (
                  <span className="ud-stat-skeleton-line ud-stat-skeleton-line--label-wide" />
                ) : (
                  "Active Subscriptions"
                )}
              </p>
              <h2>
                {showDashboardSkeleton ? (
                  <span className="ud-stat-skeleton-line ud-stat-skeleton-line--value" />
                ) : summaryLoadFailed ? (
                  <span className="ud-stat-kpi-na" title={sectionErrors.summary}>
                    —
                  </span>
                ) : (
                  `${activeSubscriptions} Subscribed`
                )}
              </h2>
            </button>
            <button
  className="ud-stat ud-stat-action"
  type="button"
  onClick={() => navigate("/support/chat")}
>
  <p>
    {showDashboardSkeleton ? (
      <span className="ud-stat-skeleton-line" />
    ) : (
      "My Tickets"
    )}
  </p>

  <h2>
    {showDashboardSkeleton ? (
      <span className="ud-stat-skeleton-line ud-stat-skeleton-line--value" />
    ) : sectionErrors.tickets ? (
      <span className="ud-stat-kpi-na" title={sectionErrors.tickets}>
        —
      </span>
    ) : ticketsKpiCount !== null ? (
      String(ticketsKpiCount)
    ) : (
      <span
        className="ud-stat-kpi-na"
        title="Ticket count unavailable from server"
      >
        —
      </span>
    )}
  </h2>
</button>
        </div>

        <div
          className="ud-card ud-usage-card ud-bento-chart ud-usage-card--app-analytics"
          aria-busy={showDashboardSkeleton}
        >
            <div className="ud-usage-head">
              <h3 className="ud-card-h" style={{ margin: 0 }}>
                App usage analytics
              </h3>
              <div className="ud-usage-pills" />
            </div>

            {showDashboardSkeleton ? (
              <ChartSkeleton matchUsageChartHeight />
            ) : (
              <div className="ud-app-usage-block" ref={appUsageBlockRef}>
                <div className="ud-app-usage-toolbar">
                  <div className="ud-app-usage-field" ref={usageAppPickerRef}>
                    <span className="ud-app-usage-label" id="ud-app-usage-app-lbl">
                      App
                    </span>
                    <div className="ud-app-usage-picker">
                      <button
                        type="button"
                        className="ud-app-usage-picker-btn"
                        aria-labelledby="ud-app-usage-app-lbl"
                        aria-haspopup="listbox"
                        aria-expanded={usageAppPickerOpen}
                        disabled={usageAppOptions.length === 0}
                        onClick={() =>
                          setUsageAppPickerOpen((v) => {
                            const next = !v;
                            if (next) engageUsagePrefetch();
                            return next;
                          })
                        }
                      >
                        {selectedUsageAppOption ? (
                          <>
                            <span className="ud-app-usage-picker-ico" aria-hidden>
                              <AppCatalogLogo
                                src={selectedUsageAppOption.logoUrl}
                                name={selectedUsageAppOption.label}
                                size={28}
                              />
                            </span>
                            <span className="ud-app-usage-picker-label">
                              {selectedUsageAppOption.label}
                            </span>
                          </>
                        ) : (
                          <span className="ud-app-usage-picker-label">No apps</span>
                        )}
                        <span className="ud-app-usage-picker-chev" aria-hidden>
                          ▾
                        </span>
                      </button>
                      {usageAppPickerOpen && usageAppOptions.length > 0 ? (
                        <ul
                          className="ud-app-usage-picker-list"
                          role="listbox"
                          aria-label="Choose app"
                        >
                          {usageAppOptions.map((o) => (
                            <li key={o.appId} role="none">
                              <button
                                type="button"
                                role="option"
                                aria-selected={o.appId === selectedUsageAppId}
                                className={`ud-app-usage-picker-item${
                                  o.appId === selectedUsageAppId
                                    ? " ud-app-usage-picker-item--active"
                                    : ""
                                }`}
                                onClick={() => {
                                  setSelectedUsageAppId(o.appId);
                                  recordDashboardUsageAppPick(o.appId);
                                  try {
                                    window.localStorage.setItem(
                                      USAGE_APP_STORAGE_KEY,
                                      o.appId,
                                    );
                                  } catch {
                                    /* private mode */
                                  }
                                  setUsageAppPickerOpen(false);
                                }}
                              >
                                <span className="ud-app-usage-picker-ico" aria-hidden>
                                  <AppCatalogLogo src={o.logoUrl} name={o.label} size={28} />
                                </span>
                                <span className="ud-app-usage-picker-item-text">
                                  {o.label}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                  <div
                    className="ud-app-usage-ranges"
                    role="group"
                    aria-label="Usage time range"
                  >
                    {[
                      { id: "24h", label: "24H" },
                      { id: "7d", label: "7D" },
                      { id: "30d", label: "30D" },
                    ].map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`ud-app-usage-range${usageRange === r.id ? " ud-app-usage-range--active" : ""}`}
                        onClick={() => {
                          engageUsagePrefetch();
                          setUsageRange(r.id);
                        }}
                        disabled={usageAppOptions.length === 0}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {usageChartError ? (
                  <p className="ud-section-error ud-section-error--compact" role="alert">
                    {usageChartError}
                  </p>
                ) : null}
                {usageChartRetrying ? (
                  <p className="ud-app-usage-retry" role="status">
                    Retrying…
                  </p>
                ) : null}
                {usageAppOptions.length === 0 ? (
                  <p className="ud-app-usage-empty" role="status">
                    Add or open apps to see usage analytics here.
                  </p>
                ) : usageChartLoading ? (
                  <ChartSkeleton matchUsageChartHeight />
                ) : !usageChartError && usageSeriesRows.length === 0 ? (
                  <p className="ud-app-usage-empty" role="status">
                    No usage data for selected period
                  </p>
                ) : !usageChartError ? (
                  <Suspense fallback={<ChartSkeleton matchUsageChartHeight />}>
                    <AppUsageChart
                      rows={usageSeriesRows}
                      appName={selectedUsageAppLabel}
                    />
                  </Suspense>
                ) : null}
              </div>
            )}
          </div>

        <div
          className="ud-card ud-bento-txn"
          aria-busy={showDashboardSkeleton}
        >
            <div className="ud-txn-card-head">
              <h3 className="ud-card-h" style={{ margin: 0 }}>
                Transaction History
              </h3>
              <button
                type="button"
                className="ud-btn-outline ud-txn-export-btn"
                disabled={
                  showDashboardSkeleton || filteredTransactions.length === 0
                }
                onClick={handleExportTransactionsCsv}
              >
                Export CSV
              </button>
            </div>
            {!showDashboardSkeleton && sectionErrors.transactions ? (
              <p className="ud-section-error ud-section-error--compact" role="alert">
                {sectionErrors.transactions}
              </p>
            ) : null}
            <ul className="ud-txn-list ud-bento-txn-list">
              {showTxnSkeleton ? <TxnListSkeletonRows count={6} /> : null}
              {!showDashboardSkeleton && filteredTransactions.length === 0 ? (
                <li className="ud-empty-state ud-empty-state--stack" role="status">
                  <span className="ud-empty-state-title">
                    {query
                      ? "No matching transactions"
                      : "No transactions yet. Start using apps to see activity here."}
                  </span>
                  <span className="ud-empty-state-sub">
                    {query
                      ? "Try a different search term or clear the field to see all loaded payments."
                      : "When payments post, they will appear here. This list reflects your account only — nothing is fabricated."}
                  </span>
                </li>
              ) : null}
              {!showDashboardSkeleton &&
                filteredTransactions.map((txn) => (
                  <li className="ud-txn-item" key={txn.rowKey}>
                    <InvoiceIcon bg={txn.iconBg} color={txn.iconColor} />
                    <div className="ud-txn-info">
                      <p>{txn.id}</p>
                      <small>{txn.time}</small>
                    </div>
                    <div className="ud-txn-right">
                      <p className={txn.status === "Failed" ? "ud-fail-amt" : ""}>
                        {txn.amount}
                      </p>
                      <span
                        className={`ud-pill ud-pill-${txn.status.toLowerCase()}`}
                      >
                        {txn.status}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>

            {txnRetrying ? (
              <p className="ud-txn-retry-hint" role="status">
                Retrying…
              </p>
            ) : null}
            {!showDashboardSkeleton && transactionsTotalPages > 1 ? (
              <div className="ud-txn-pagination" role="navigation" aria-label="Transactions pagination">
                <button
                  type="button"
                  className="ud-btn-outline ud-txn-page-btn"
                  onClick={() => loadTransactionsPage(transactionsPage - 1)}
                  disabled={transactionsPageLoading || transactionsPage <= 0}
                >
                  Prev
                </button>
                <div className="ud-txn-page-meta" aria-live="polite">
                  <span className="ud-txn-page-meta-strong">
                    Page {transactionsPage + 1} of {transactionsTotalPages}
                  </span>
                  <span className="ud-txn-page-meta-sub">
                    {transactionsTotalElements} total
                  </span>
                </div>
                <button
                  type="button"
                  className="ud-btn-outline ud-txn-page-btn"
                  onClick={() => loadTransactionsPage(transactionsPage + 1)}
                  disabled={transactionsPageLoading || transactionsLastPage}
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>

        <div className="ud-bento-midrow">
          <div className="ud-bento-midcol ud-bento-midcol--stack">
            <div
              className="ud-card ud-recent-apps-card ud-bento-apps"
              aria-busy={showDashboardSkeleton}
            >
              <h3 className="ud-card-h">Recently Accessed Apps</h3>
              {!showDashboardSkeleton && sectionErrors.recentApps ? (
                <p className="ud-section-error ud-section-error--compact" role="alert">
                  {sectionErrors.recentApps}
                </p>
              ) : null}
              <div className="ud-apps-grid">
                {showDashboardSkeleton ? <AppsGridSkeleton /> : null}
                {!showDashboardSkeleton &&
                !sectionErrors.recentApps &&
                recentAppsForGrid.length === 0 ? (
                  <p
                    className="ud-empty-state ud-empty-state--stack ud-empty-state--block"
                    role="status"
                  >
                    <span className="ud-empty-state-title">
                      {query ? "No apps match your search" : "No recent apps yet"}
                    </span>
                    <span className="ud-empty-state-sub">
                      {query
                        ? "Clear the search or try another app name."
                        : "Apps you open will appear here with a quick link."}
                    </span>
                  </p>
                ) : null}
                {!showDashboardSkeleton &&
                  recentAppsForGrid.map((app) => (
                    <div className="ud-app-entry" key={app.key}>
                      <AppCatalogLogo src={app.logoUrl} name={app.name} size={40} />
                      <div className="ud-app-meta">
                        <p>{app.name}</p>
                        <small>{app.time}</small>
                      </div>
                      <button
                        type="button"
                        className="ud-btn-open"
                        onClick={() => {
                          void openUserCatalogApp(
                            {
                              appId: app.appId,
                              status: app.status,
                              externalUrl: app.externalUrl,
                              routePath: app.routePath,
                              appUrl: app.appUrl,
                            },
                            {
                              navigate,
                              applicationBackend,
                              onAfterOpen: () =>
                                invalidateDashboardData("application-opened"),
                            },
                          ).then((r) => {
                            if (!r.ok && r.reason === "unpublished") {
                              showError("This app is not available.");
                            } else if (!r.ok && r.reason === "no-target") {
                              showError("No link is configured for this app.");
                            }
                          });
                        }}
                      >
                        Open
                      </button>
                    </div>
                  ))}
              </div>
            </div>
            <div className="ud-action-strip ud-bento-actions">
              <div className="ud-action-card">
                <h3>Complete KYC</h3>
                <p>Status: {kycDashboardLabel}</p>
                <p className="ud-muted-xs">Verify your identity for full access.</p>
                <button
                  className="ud-btn-blue"
                  onClick={() => navigate("/profile")}
                >
                  {kycDashboardVerified ? "View in profile" : "Continue"}
                </button>
              </div>
              <div className="ud-action-card">
                <h3>Account Settings</h3>
                <p>Manage your account preferences</p>
                <button
                  className="ud-btn-blue"
                  onClick={() => navigate("/settings")}
                >
                  Go to Settings
                </button>
              </div>
            </div>
          </div>

          <div className="ud-bento-midcol ud-bento-midcol--stack">
            <div
              className="ud-card ud-bento-activity"
              aria-busy={showDashboardSkeleton}
            >
              <div className="ud-ra-head">
                <h3 className="ud-card-h" style={{ margin: 0 }}>
                  Recent Activity
                </h3>
                <span className="ud-muted-xs">Recent account activity</span>
              </div>
              {!showDashboardSkeleton && sectionErrors.activity ? (
                <p className="ud-section-error ud-section-error--compact" role="alert">
                  {sectionErrors.activity}
                </p>
              ) : null}
              <ul className="ud-ra-list">
                {showDashboardSkeleton ? (
                  <ActivitySkeletonRows count={6} />
                ) : null}
                {!showDashboardSkeleton && filteredActivity.length === 0 ? (
                  <li
                    className="ud-empty-state ud-empty-state--stack"
                    role="status"
                  >
                    <span className="ud-empty-state-title">
                      {query ? "No matching activity" : "No recent activity yet"}
                    </span>
                    <span className="ud-empty-state-sub">
                      {query
                        ? "Broaden your search to include more keywords."
                        : "Payments and tickets from the loaded lists above will surface here automatically."}
                    </span>
                  </li>
                ) : null}
                {!showDashboardSkeleton &&
                  filteredActivity.map((item) => (
                  <li className="ud-ra-item" key={item.key}>
                    <span className="ud-act-dot" />
                    <div className="ud-ra-body">
                      <span>{item.text}</span>
                      {item.status && (
                        <span
                          className={(() => {
                            const slug = String(item.status)
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, "-")
                              .replace(/^-|-$/g, "");
                            const tone = ["paid", "failed", "open", "pending"].includes(slug)
                              ? slug
                              : "pending";
                            return `ud-pill ud-pill-${tone}`;
                          })()}
                        >
                          {item.status}
                        </span>
                      )}
                    </div>
                    <span className="ud-muted-xs" style={{ flexShrink: 0 }}>
                      {item.time}
                    </span>
                  </li>
                  ))}
              </ul>
            </div>

            <div className="ud-card ud-bento-whatsnew">
              <div className="ud-wn-head">
                <div className="ud-wn-title">
                  <h3>What's New</h3>
                  <span className="ud-new-badge">New</span>
                  <span>🚀</span>
                </div>
              </div>
              <ul className="ud-wn-list">
                {whatsNewLoading ? (
                  <li className="ud-muted-xs">Loading updates…</li>
                ) : null}
                {!whatsNewLoading && whatsNewError ? (
                  <li className="ud-muted-xs">Updates unavailable right now.</li>
                ) : null}
                {!whatsNewLoading &&
                  !whatsNewError &&
                  whatsNewItems.length === 0 ? (
                  <li className="ud-muted-xs">No announcements yet.</li>
                ) : null}
                {whatsNewItems.map((item) => (
                  <li key={item.id}>
                    <span className="ud-wn-ico">{item.icon}</span>
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="ud-card ud-bento-support">
          <h3 className="ud-card-h">Support</h3>
          <p className="ud-support-soon-banner" style={{ marginBottom: 10 }}>
            Get help, track tickets, and share updates with our support team.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="ud-btn-outline"
              onClick={() => navigate("/support/chat")}
            >
              My tickets
            </button>
            <button
              type="button"
              className="ud-btn-outline"
              onClick={() => navigate("/support/ticket")}
            >
              Raise ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
