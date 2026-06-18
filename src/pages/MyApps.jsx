import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { applicationBackend } from "../services/backendApis";
import { showError, showSuccess } from "../services/toast";
import { invalidateDashboardData } from "../services/dashboardInvalidate";
import { emitMyAppsChanged, onMyAppsChanged, onAppsCatalogChanged } from "../services/uiEvents";
import {
  openUserCatalogApp,
  resolveUserAppOpenTarget,
  appSubscriptionIdKey,
} from "../utils/appNavigation";
import { pickAppLogoUrl } from "../utils/adminApps";
import AppCatalogLogo from "../components/AppCatalogLogo";

export default function MyApps() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [appsCatalog, setAppsCatalog] = useState([]);
  const [myAppsRaw, setMyAppsRaw] = useState([]);
  const [catalogReload, setCatalogReload] = useState(0);
  const [unsubscribeLoadingId, setUnsubscribeLoadingId] = useState(null);

  useEffect(() => onAppsCatalogChanged(() => setCatalogReload((n) => n + 1)), []);

  useEffect(() => {
    let alive = true;

    const loadAll = async () => {

      setLoading(true);
    
      setError("");
    
      try {
    
        const [catalog, mine] = await Promise.all([
    
          applicationBackend.list(),
    
          applicationBackend.my(),
        ]);
    
        if (!alive) return;
    
        // =========================
        // CATALOG
        // =========================
    
        const catalogData =
    
          Array.isArray(catalog)
            ? catalog
            : Array.isArray(catalog?.data)
            ? catalog.data
            : Array.isArray(catalog?.content)
            ? catalog.content
            : Array.isArray(catalog?.applications)
            ? catalog.applications
            : [];
    
        setAppsCatalog(catalogData);
    
        // =========================
        // MY APPS
        // =========================
    
        const mineData =
    
          Array.isArray(mine)
            ? mine
            : Array.isArray(mine?.data)
            ? mine.data
            : Array.isArray(mine?.content)
            ? mine.content
            : Array.isArray(mine?.applications)
            ? mine.applications
            : [];
            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.log("[MyApps] loaded", { count: mineData.length });
            }
        setMyAppsRaw(mineData);
        
    
      } catch (serviceError) {
    
        if (!alive) return;
    
        setError(
          serviceError?.message ||
          "Unable to load your apps."
        );
    
      } finally {
    
        if (alive) {
    
          setLoading(false);
        }
      }
    };

    const refreshMine = async () => {

      try {
    
        const mine =
          await applicationBackend.my();
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log("[MyApps] refresh", { count: Array.isArray(mine) ? mine.length : 0 });
          }
    
        const mineData =
    
          Array.isArray(mine)
            ? mine
            : Array.isArray(mine?.data)
            ? mine.data
            : Array.isArray(mine?.content)
            ? mine.content
            : Array.isArray(mine?.applications)
            ? mine.applications
            : [];
    
        setMyAppsRaw(mineData);
    
      } catch (err) {
    
        console.error(err);
      }
    };
    
    loadAll();
    
    const off = onMyAppsChanged(() => {
    
      refreshMine();
    });
    
    return () => {
    
      alive = false;
    
      off();
    };
    
    }, [catalogReload]);

  const myApps = useMemo(() => {
  
    const catalogMap = new Map();
  
    (Array.isArray(appsCatalog)
      ? appsCatalog
      : []
    ).forEach((app) => {
  
      const key =
        app?.appId ??
        app?.id;
  
      if (key != null) {
  
        catalogMap.set(
          Number(key),
          app
        );
      }
    });
  
    
  
    const rows = Array.isArray(myAppsRaw)
    ? myAppsRaw
    : [];
  
  // ======================================
  // REMOVE DUPLICATES
  // ======================================
  
  const uniqueMap = new Map();
  
  rows.forEach((row) => {
  
    const appId = Number(
      row?.appId ??
      row?.id ??
      row?.app?.appId ??
      row?.app?.id
    );
  
    if (!appId) return;
  
    const existing =
      uniqueMap.get(appId);
  
    // keep highest usage count
    if (!existing) {
  
      uniqueMap.set(appId, row);
  
      return;
    }
  
    const oldCount =
      Number(existing?.visitCounter || 0);
  
    const newCount =
      Number(row?.visitCounter || 0);
  
    if (newCount > oldCount) {
  
      uniqueMap.set(appId, row);
    }
  });
  
  // ======================================
  // FINAL MAP
  // ======================================
  
  return Array.from(uniqueMap.values()).map((row) => {
    const appId = Number(
      row?.appId ??
      row?.id ??
      row?.app?.appId ??
      row?.app?.id
    );
  
    const meta =
      catalogMap.get(appId) ||
      row?.app ||
      {};
  
    const externalUrl = String(
      meta?.externalUrl || ""
    ).trim();
  
    const routePath = String(
      meta?.routePath ||
      meta?.route ||
      ""
    ).trim();
  
    let appUrl = String(
      meta?.appUrl ||
      meta?.url ||
      ""
    ).trim();
  
    if (!appUrl) {
  
      if (externalUrl) {
  
        appUrl = externalUrl;
  
      } else if (routePath) {
  
        appUrl = routePath.startsWith("/")
          ? routePath
          : `/${routePath}`;
      }
    }
  
    return {
  
      appId,
  
      name:
        meta?.appName ||
        meta?.name ||
        row?.name ||
        `App #${appId}`,
  
      description:
        meta?.appText ||
        meta?.description ||
        row?.description ||
        "—",
  
      category:
        meta?.appType ||
        meta?.category ||
        "APP",
  
      appUrl,

      appLogo: pickAppLogoUrl(
        meta?.appLogo,
        meta?.logoUrl,
        meta?.iconUrl,
        meta?.imageUrl,
        meta?.resolvedImage,
        row?.appLogo,
        row?.logoUrl,
        row?.iconUrl,
        row?.imageUrl,
        row?.resolvedImage,
      ),

      externalUrl,
  
      routePath,
  
      status:
        meta?.status ||
        row?.status,
  
        

        visitCounter: parseInt(
          row?.visitCounter ||
          row?.visit_counter ||
          row?.app?.visitCounter ||
          row?.app?.visit_counter ||
          row?.usageCount ||
          row?.usage_count ||
          row?.counter ||
          0,
          10
        ),
  
      subscriptionStatus: String(
        row?.subscriptionStatus ||
        "ACTIVE"
      ).toUpperCase(),
  
      updatedAt:
        row?.updatedAt,
    };
  });
  }, [appsCatalog, myAppsRaw]);

  const categories = useMemo(
    () => ["All", ...new Set(myApps.map((app) => app.category).filter(Boolean))],
    [myApps],
  );

  const filteredApps = Array.from(

  new Map(

    myApps

      // REMOVE BROKEN APPS
      .filter((app) => {

        return Boolean(

          app?.appId &&

          (
            app?.appUrl ||
            app?.externalUrl ||
            app?.routePath
          )
        );
      })

      // KEEP ONLY ONE APP
      .map((app) => [

        Number(app.appId),

        app,
      ])

  ).values()

).filter((app) => {

  const matchesSearch =

    `${app.name} ${app.description}`
      .toLowerCase()
      .includes(
        search.trim().toLowerCase()
      );

  const matchesCategory =

    category === "All" ||

    app.category === category;

  return matchesSearch &&
         matchesCategory;
});
  const handleOpenMyApp = async (app) => {
    const r = await openUserCatalogApp(app, {
      navigate,
      applicationBackend,
      allowUnpublished: true,
      onAfterOpen: () => invalidateDashboardData("application-opened"),
    });
    if (!r.ok && r.reason === "no-target") {
      showError("No link is configured for this app.");
    }
  };

  const handleUnsubscribe = async (app) => {
    const appId = app?.appId ?? app?.id;
    const key = appSubscriptionIdKey(appId);
    if (key == null || unsubscribeLoadingId != null) return;

    const snapshot = Array.isArray(myAppsRaw) ? [...myAppsRaw] : [];
    setUnsubscribeLoadingId(key);
    setMyAppsRaw((prev) =>
      (Array.isArray(prev) ? prev : []).filter(
        (row) => appSubscriptionIdKey(row) !== key,
      ),
    );

    try {
      await applicationBackend.unsubscribe(appId);
      emitMyAppsChanged();
      invalidateDashboardData("my-apps-unsubscribe");
      showSuccess("Removed from My Apps");
    } catch (e) {
      setMyAppsRaw(snapshot);
      showError(e?.message || "Unable to unsubscribe");
    } finally {
      setUnsubscribeLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "50px" }}>
        <div
          style={{
            width: "40px",
            height: "40px",
            border: "4px solid #f3f3f3",
            borderTop: "4px solid #2563eb",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 20px",
          }}
        ></div>
        <p>Loading your applications...</p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: "50px", color: "#b91c1c" }}>
        {error}
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "30px" }}>
        <h1
          style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "10px" }}
        >
          My Applications
        </h1>
        <p style={{ color: "#666", fontSize: "16px" }}>
          Manage your subscribed applications and track usage
        </p>
        <div
          style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}
        >
          <input
            type="text"
            placeholder="Search my apps..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "8px 12px",
              minWidth: 220,
            }}
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            {categories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filteredApps.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            background: "#fff",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          <h3 style={{ color: "#6b7280", marginBottom: "10px" }}>
            No applications yet
          </h3>
          <p style={{ color: "#9ca3af" }}>
            No matching apps found. Try another filter.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
            gap: "20px",
          }}
        >
          {filteredApps.map((app) => (
            <div
              key={app.appId}
              style={{
                padding: "24px",
                borderRadius: "12px",
                background: "#fff",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                border: "1px solid #e5e7eb",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 8px 20px rgba(0,0,0,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "12px",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  <AppCatalogLogo src={app.appLogo} name={app.name} size={44} />
                  <h3 style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>
                    {app.name}
                  </h3>
                </div>
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: "500",
                    backgroundColor: "#dcfce7",
                    color: "#166534",
                  }}
                >
                  Active
                </span>
              </div>

              <p
                style={{
                  color: "#6b7280",
                  marginBottom: "16px",
                  lineHeight: "1.5",
                }}
              >
                {app.description}
              </p>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <span
                  style={{
                    padding: "4px 12px",
                    backgroundColor: "#f3f4f6",
                    borderRadius: "20px",
                    fontSize: "14px",
                    color: "#374151",
                  }}
                >
                  {app.category}
                </span>
                <span style={{ fontSize: "14px", color: "#6b7280" }}>
                  Updated:{" "}
                  {app.updatedAt ? new Date(app.updatedAt).toLocaleString() : "—"}
                </span>
              </div>

              <div
                style={{
                  marginBottom: 16,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: "#f1f5f9",
                    color: "#0f172a",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  Usage: {app.visitCounter || 0}
                </span>
                <span
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    background:
                      app.subscriptionStatus === "ACTIVE"
                        ? "#dcfce7"
                        : "#fee2e2",
                    color:
                      app.subscriptionStatus === "ACTIVE"
                        ? "#166534"
                        : "#991b1b",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  {app.subscriptionStatus}
                </span>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "8px 16px",
                    backgroundColor: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "14px",
                    cursor: "pointer",
                    transition: "background-color 0.2s",
                    opacity:
                      unsubscribeLoadingId === appSubscriptionIdKey(app.appId)
                        ? 0.65
                        : 1,
                  }}
                  disabled={
                    unsubscribeLoadingId === appSubscriptionIdKey(app.appId)
                  }
                  onClick={() => {
                    if (resolveUserAppOpenTarget(app).kind === "none") {
                      showError("No link is configured for this app.");
                      return;
                    }
                    void handleOpenMyApp(app);
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "#1d4ed8")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "#2563eb")
                  }
                >
                  Open App
                </button>
                <button
                  type="button"
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#fff",
                    color: "#64748b",
                    border: "1px solid #e2e8f0",
                    borderRadius: "6px",
                    fontSize: "14px",
                    cursor: "pointer",
                    minWidth: 110,
                  }}
                  disabled={
                    unsubscribeLoadingId === appSubscriptionIdKey(app.appId)
                  }
                  onClick={() => void handleUnsubscribe(app)}
                >
                  {unsubscribeLoadingId === appSubscriptionIdKey(app.appId)
                    ? "Removing…"
                    : "Unsubscribe"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
