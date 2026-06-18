import {
  applicationBackend,
  dashboardBackend,
  favoritesBackend,
} from "./backendApis";

function formatInr(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Last N local days: transaction counts per day from loaded rows (for Home chart).
 */
function buildHomeTxnChartSeries(rows, dayCount = 7) {
  const labels = [];
  const keys = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    keys.push(localDateKey(d));
    labels.push(d.toLocaleDateString("en-IN", { weekday: "short" }));
  }
  const counts = keys.map(() => 0);
  let totalHits = 0;
  for (const row of rows) {
    const raw = row?.paymentDate;
    if (!raw) continue;
    const ms = new Date(raw).getTime();
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const k = localDateKey(d);
    const idx = keys.indexOf(k);
    if (idx >= 0) {
      counts[idx] += 1;
      totalHits += 1;
    }
  }
  const maxCount = Math.max(...counts, 1);
  const span = Math.max(dayCount - 1, 1);
  const xs = counts.map((_, i) => 10 + i * (300 / span));
  const ys = counts.map((c) => {
    const t = maxCount <= 0 ? 0 : c / maxCount;
    return 110 - Math.round(t * 85);
  });
  const linePoints = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const lastX = xs[xs.length - 1] ?? 10;
  const areaPoints = `${linePoints} ${lastX},120 10,120`;

  return {
    labels,
    counts,
    totalHits,
    maxCount,
    linePoints,
    areaPoints,
  };
}

function mapTxnDisplay(apiStatus) {
  const u = String(apiStatus || "").toUpperCase();
  if (u === "SUCCESS") return { label: "Paid", tone: "success" };
  if (u === "FAILED" || u === "FAILURE") return { label: "Failed", tone: "danger" };
  if (u === "PENDING") return { label: "Pending", tone: "warning" };
  return {
    label: apiStatus ? String(apiStatus) : "Unknown",
    tone: "neutral",
  };
}

function txnIconColor(tone) {
  if (tone === "danger") return "#f59e0b";
  if (tone === "warning") return "#f59e0b";
  if (tone === "success") return "#2563eb";
  return "#64748b";
}

export const dashboardApi = {
  /**
   * Home bundle builder for `src/pages/Home.jsx`.
   * There is no confirmed `/dashboard/home` API, so we compose from live endpoints.
   */
  async getHomeData() {
    const [summary, txPage, apps, myApps, favs] = await Promise.all([
      dashboardBackend.getSummary().catch(() => null),
      dashboardBackend.getTransactions({ page: 0, size: 80 }).catch(() => null),
      applicationBackend.list().catch(() => []),
      applicationBackend.my().catch(() => []),
      favoritesBackend.list().catch(() => []),
    ]);

    const txns = Array.isArray(txPage)
      ? txPage
      : Array.isArray(txPage?.content)
        ? txPage.content
        : Array.isArray(txPage?.data)
          ? txPage.data
          : [];
    const appsList = Array.isArray(apps)
      ? apps
      : Array.isArray(apps?.content)
        ? apps.content
        : Array.isArray(apps?.apps)
          ? apps.apps
          : [];
    const myList = Array.isArray(myApps) ? myApps : [];
    const favIds = new Set(
      (Array.isArray(favs) ? favs : [])
        .map((x) => x?.appId ?? x?.id ?? x)
        .filter((v) => v !== undefined && v !== null)
        .map((v) => Number(v)),
    );

    const totalApps = Number(summary?.totalApps ?? 0) || 0;
    const activeSubscriptions = Number(summary?.activeSubscriptions ?? 0) || 0;
    const referralCount = Number(summary?.referralCount ?? 0) || 0;
    const kycStatus = String(summary?.kycStatus || "PENDING").toUpperCase();

    const stats = [
      {
        title: "All Apps",
        value: `${totalApps} Apps`,
        hint: "Browse available tools",
        accent: "#2563eb",
        route: "/all-apps",
        action: "Explore apps",
      },
      {
        title: "Active Subscriptions",
        value: `${activeSubscriptions} Subscribed`,
        hint: "Your current access",
        accent: "#0f766e",
        route: "/my-apps",
        action: "View my apps",
      },
      {
        title: "Referrals",
        value: String(referralCount),
        hint: kycStatus === "PENDING" ? "Complete KYC to unlock benefits" : "Invite more users",
        accent: "#ea580c",
        route: "/profile",
        action: "View profile",
      },
    ];

    const chartSeries = buildHomeTxnChartSeries(txns, 7);

    const transactions = txns.slice(0, 8).map((t, i) => {
      const disp = mapTxnDisplay(t?.status);
      const title =
        (t?.paymentDescription && String(t.paymentDescription).trim()) ||
        `Txn #${t?.id ?? i}`;
      return {
        rowKey: `${t?.id ?? `idx-${i}`}-${t?.paymentDate ?? ""}`,
        id: title,
        time: t.paymentDate ? new Date(t.paymentDate).toLocaleString() : "—",
        amount: formatInr(Number(t.amount ?? 0) || 0),
        status: disp.label,
        tone: disp.tone,
        color: txnIconColor(disp.tone),
      };
    });

    const appsCards = appsList.slice(0, 6).map((a) => ({
      appId: a.appId,
      name: a.appName,
      time: a.createdAt
        ? `Listed ${new Date(a.createdAt).toLocaleDateString()}`
        : "—",
      color: "#2563eb",
      description: a.appText || "—",
      route: "/all-apps",
      appUrl: String(a.appUrl || "").trim(),
    }));

    const recommendedActions = [
      kycStatus !== "VERIFIED"
        ? {
            title: "Complete KYC verification",
            description: "Unlock the full set of apps and faster approvals.",
            action: "Go to profile",
            route: "/profile",
            color: "#2563eb",
          }
        : null,
      {
        title: "Review your apps",
        description: "Manage your subscriptions and usage.",
        action: "Open My Apps",
        route: "/my-apps",
        color: "#f97316",
      },
      {
        title: "Check favorites",
        description: `${favIds.size} apps saved for quick access.`,
        action: "Open favorites",
        route: "/favorites",
        color: "#7c3aed",
      },
    ].filter(Boolean);

    const recentRight = myList.slice(0, 4).map((row) => {
      const raw = String(row.subscriptionStatus || "").toUpperCase();
      let status = "";
      if (raw === "ACTIVE") status = "Active";
      else if (raw === "FAILED" || raw === "CANCELLED" || raw === "EXPIRED") status = "Failed";
      else if (raw === "PENDING") status = "Open";
      else if (raw) status = raw.charAt(0) + raw.slice(1).toLowerCase();
      return {
        title: `App #${row.id}`,
        time: row.updatedAt
          ? new Date(row.updatedAt).toLocaleDateString()
          : "recent",
        status,
      };
    });

    const usageBreakdown = myList.slice(0, 3).map((row) => ({
      app: `App #${row.id}`,
      used: `${Number(row.visitCounter ?? 0)} visits`,
      percent: Math.min(100, Number(row.visitCounter ?? 0) * 10),
      color: "#2563eb",
    }));

    return {
      stats,
      transactions,
      chartSeries,
      apps: appsCards,
      recommendedActions,
      recentRight,
      usageBreakdown,
    };
  },

  /**
   * GET /dashboard (fallback: /dashboard/summary)
   * @param {object} [meta] — e.g. `{ suppressGlobalServerErrorToast: true }` for bundled loads
   */
  async getSummary(meta = {}) {
    return dashboardBackend.getSummary(meta);
  },

  /**
   * GET /dashboard/transactions?page=&size=
   * @param {object} [meta] — forwarded to `dashboardBackend.getTransactions`
   */
  async getTransactions(page = 0, size = 10, meta = {}) {
    return dashboardBackend.getTransactions({ page, size, ...meta });
  },
};
