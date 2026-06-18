import { useEffect, useState } from "react";
import { activityBackend } from "../services/backendApis";
import { PageEmpty, PageError, PageLoading } from "../components/PageStates";

const PAGE_SIZE = 10;

function normalizeActivityResponse(pageRes, pageIndex) {
  // SPRING WRAPPER
  const payload =
    pageRes?.data ??
    pageRes;

  let rawList = [];

  if (Array.isArray(payload)) {

    rawList = payload;

  } else if (Array.isArray(payload?.content)) {

    rawList = payload.content;

  } else if (Array.isArray(payload?.items)) {

    rawList = payload.items;
  }

  const list = rawList.map((a, idx) => ({

    id:
      a?.id ??
      `${pageIndex}-${idx}`,

    type:
      a?.type ||
      a?.category ||
      a?.action ||
      "update",

    title:
      a?.title ||
      a?.event ||
      a?.action ||
      a?.description?.split?.(".")?.[0] ||
      "Activity",

    description:
      a?.description ||
      a?.message ||
      a?.details ||
      "",

    timestamp:
      a?.timestamp ||
      a?.createdAt ||
      a?.at ||
      new Date().toISOString(),

    status:
      a?.status ||
      "success",
  }));

  // META SUPPORT
  const meta =
    pageRes?.meta ??
    {};

  let totalPages = Number(
    meta?.totalPages ??
    payload?.totalPages
  );

  if (
    !Number.isFinite(totalPages) ||
    totalPages < 1
  ) {

    totalPages = 1;
  }

  return {
    list,
    totalPages,
  };
}

export default function Activity() {
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activities, setActivities] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const loadActivity = async () => {
      setLoading(true);
      setError("");
      try {
        const pageRes = await activityBackend.list({ page, size: PAGE_SIZE });
        const { list, totalPages: tp } = normalizeActivityResponse(pageRes, page);

        if (!isMounted) return;
        setActivities(list);
        setTotalPages(tp);
      } catch (serviceError) {
        if (!isMounted) return;
        setError(serviceError?.message || "Unable to load activity.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadActivity();

    return () => {
      isMounted = false;
    };
  }, [page, reloadNonce]);

  const filteredActivities = activities.filter((activity) => {
    if (filter === "all") return true;
    return activity.type === filter;
  });

  const getStatusColor = (status) => {
    switch (status) {
      case "success":
        return "#16a34a";
      case "error":
        return "#dc2626";
      case "warning":
        return "#d97706";
      case "info":
      default:
        return "#2563eb";
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return <PageLoading title="Loading activity..." />;
  }

  if (error) {
    return (
      <PageError
        message={error}
        onRetry={() => {
          setReloadNonce((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="activity-page-root" style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <style>{`
        @media (max-width: 768px) {
          .activity-page-root { padding: 16px !important; }
          .activity-page-root h1 { font-size: 24px !important; }
          .activity-controls { flex-direction: column !important; align-items: stretch !important; }
          .activity-controls select { width: 100% !important; }
          .summary-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 480px) {
          .activity-page-root { padding: 12px !important; }
          .activity-page-root h1 { font-size: 20px !important; }
          .activity-controls { gap: 12px !important; }
          .activity-item { flex-direction: column !important; gap: 8px !important; }
          .summary-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <h1
        style={{
          marginBottom: 8,
          fontSize: 30,
          letterSpacing: "-0.4px",
          color: "#0f172a",
          fontWeight: 950,
        }}
      >
        Activity
      </h1>
      <p style={{ margin: "0 0 22px", color: "#64748b", fontSize: 14, fontWeight: 650 }}>
        Account timeline from the server, paginated for faster loads.
      </p>

      <div
        style={{
          background: "linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)",
          borderRadius: 16,
          padding: 22,
          marginBottom: 18,
          border: "1px solid rgba(37,99,235,0.12)",
          boxShadow: "0 12px 36px rgba(15,23,42,0.08)",
        }}
      >
        <div
          className="activity-controls"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 950, color: "#0f172a" }}>
            Recent events
          </h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              padding: "10px 14px",
              border: "1px solid rgba(148,163,184,0.35)",
              borderRadius: 12,
              outline: "none",
              fontWeight: 700,
              background: "#fff",
              minWidth: 200,
            }}
          >
            <option value="all">All activities</option>
            <option value="subscription">Subscriptions</option>
            <option value="login">Logins</option>
            <option value="payment">Payments</option>
            <option value="update">Updates</option>
            <option value="error">Errors</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {filteredActivities.map((activity) => (
            <div
              key={activity.id}
              className="activity-item"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: 16,
                border: "1px solid rgba(148,163,184,0.2)",
                borderRadius: 14,
                background: "rgba(255,255,255,0.85)",
              }}
            >
              <div
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: getStatusColor(activity.status),
                  flexShrink: 0,
                  marginTop: 5,
                  boxShadow: `0 0 0 3px ${getStatusColor(activity.status)}22`,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3
                  style={{
                    margin: "0 0 4px",
                    fontSize: 15,
                    color: "#0f172a",
                    fontWeight: 900,
                  }}
                >
                  {activity.title}
                </h3>
                <p
                  style={{
                    margin: "0 0 8px",
                    color: "#64748b",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                  }}
                >
                  {activity.description}
                </p>
                <small style={{ color: "#94a3b8", fontWeight: 700, fontSize: 12 }}>
                  {formatTimestamp(activity.timestamp)}
                </small>
              </div>
            </div>
          ))}
        </div>

        {filteredActivities.length === 0 && (
          <PageEmpty
            title="No activities match this filter."
            subtitle="Try “All activities” or check another page."
          />
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 18,
            gap: 12,
            flexWrap: "wrap",
            paddingTop: 14,
            borderTop: "1px solid rgba(148,163,184,0.16)",
          }}
        >
          <div style={{ color: "#64748b", fontSize: 13, fontWeight: 750 }}>
            Page {page + 1} of {totalPages}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0}
              style={{
                border: "1px solid rgba(37,99,235,0.2)",
                background: page <= 0 ? "#f8fafc" : "#eff6ff",
                color: "#1d4ed8",
                padding: "9px 16px",
                borderRadius: 12,
                cursor: page <= 0 ? "not-allowed" : "pointer",
                fontWeight: 850,
                opacity: page <= 0 ? 0.55 : 1,
              }}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{
                border: "1px solid rgba(37,99,235,0.2)",
                background: page >= totalPages - 1 ? "#f8fafc" : "#eff6ff",
                color: "#1d4ed8",
                padding: "9px 16px",
                borderRadius: 12,
                cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
                fontWeight: 850,
                opacity: page >= totalPages - 1 ? 0.55 : 1,
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)",
          borderRadius: 16,
          padding: 22,
          border: "1px solid rgba(37,99,235,0.12)",
          boxShadow: "0 12px 36px rgba(15,23,42,0.06)",
        }}
      >
        <h2 style={{ margin: "0 0 18px", fontSize: 17, fontWeight: 950, color: "#0f172a" }}>
          Quick summary (this page)
        </h2>
        <div
          className="summary-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {[
            {
              label: "Subscriptions",
              value: activities.filter((a) => a.type === "subscription").length,
              color: "#2563eb",
            },
            {
              label: "Successful",
              value: activities.filter((a) => a.status === "success").length,
              color: "#16a34a",
            },
            {
              label: "Errors",
              value: activities.filter((a) => a.status === "error").length,
              color: "#dc2626",
            },
            {
              label: "Logins",
              value: activities.filter((a) => a.type === "login").length,
              color: "#d97706",
            },
          ].map((cell) => (
            <div
              key={cell.label}
              style={{
                textAlign: "center",
                padding: 16,
                border: "1px solid rgba(148,163,184,0.18)",
                borderRadius: 14,
                background: "rgba(255,255,255,0.75)",
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 950, color: cell.color }}>{cell.value}</div>
              <div style={{ color: "#64748b", fontSize: 13, fontWeight: 750, marginTop: 4 }}>
                {cell.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
