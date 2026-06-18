import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ADMIN_APPS_DEMO_ONLY } from "../config/adminAppsMode";
import {
  adminDashboardApi,
  evaluateAppAssetUploadResponse,
  logDevAppAssetUploadAudit,
} from "../services/adminDashboardApi";
import { applicationBackend } from "../services/backendApis";
import { invalidateDashboardData } from "../services/dashboardInvalidate";
import { emitAppsCatalogChanged } from "../services/uiEvents";
import { showError, showSuccess } from "../services/toast";
import {
  APP_STATUS,
  VISIBILITY,
  computeCatalogAppUrlForApi,
  normalizeAdminAppRow,
  pickAppBannerUrl,
  pickAppLogoUrl,
  resolveAppMediaUrl,
  unwrapAssetUploadUrl,
} from "../utils/adminApps";
import {
  openUserCatalogApp,
  validateExternalUrl,
  validateRoutePath,
} from "../utils/appNavigation";
import { getAdminAppsPlaceholderRows } from "./adminAppsPlaceholderData";
import AppCatalogLogo from "./AppCatalogLogo";
import "./AdminAppsSection.css";

function notifyCatalogMutated() {
  if (ADMIN_APPS_DEMO_ONLY) return;
  emitAppsCatalogChanged();
  invalidateDashboardData("admin-apps-catalog");
}

function emptyDraft() {
  return {
    id: "",
    name: "",
    slug: "",
    description: "",
    logoUrl: "",
    bannerUrl: "",
    category: "GENERAL",
    status: APP_STATUS.DRAFT,
    visibility: VISIBILITY.PUBLIC,
    featured: false,
    routePath: "",
    externalUrl: "",
    version: "1.0.0",
  };
}

function mergeAssetResponseIntoRow(row, res, { hadLogo, hadBanner }) {
  const node = res && typeof res === "object" ? res : {};
  const data = node.data !== undefined ? node.data : node;
  const next = { ...row };
  if (hadLogo) {
    const u = pickAppLogoUrl(
      data?.logoUrl,
      hadBanner ? null : unwrapAssetUploadUrl(res),
    );
    if (u) next.logoUrl = u;
  }
  if (hadBanner) {
    const u = pickAppBannerUrl(data?.bannerUrl);
    if (u) next.bannerUrl = u;
  }
  return next;
}

export default function AdminAppsSection() {
  const navigate = useNavigate();
  const loadGenRef = useRef(0);
  const logoPickRef = useRef(null);
  const bannerPickRef = useRef(null);

  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [visibilityFilter, setVisibilityFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState("updated");
  const [viewMode, setViewMode] = useState("table");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState(() => emptyDraft());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState(null);

  const [logoPickPreview, setLogoPickPreview] = useState(null);
  const [bannerPickPreview, setBannerPickPreview] = useState(null);
  const [pendingLogoFile, setPendingLogoFile] = useState(null);
  const [pendingBannerFile, setPendingBannerFile] = useState(null);

  const revokeIfBlob = useCallback((url) => {
    if (url && String(url).startsWith("blob:")) URL.revokeObjectURL(url);
  }, []);

  const resetPickers = useCallback(() => {
    revokeIfBlob(logoPickPreview);
    revokeIfBlob(bannerPickPreview);
    setLogoPickPreview(null);
    setBannerPickPreview(null);
    setPendingLogoFile(null);
    setPendingBannerFile(null);
    if (logoPickRef.current) logoPickRef.current.value = "";
    if (bannerPickRef.current) bannerPickRef.current.value = "";
  }, [bannerPickPreview, logoPickPreview, revokeIfBlob]);

  const closeEditor = useCallback(() => {
    resetPickers();
    setEditorOpen(false);
    setEditorDraft(emptyDraft());
  }, [resetPickers]);

  const loadApps = useCallback(async (opts = {}) => {
    const silent = Boolean(opts.silent);
    const gen = ++loadGenRef.current;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    if (ADMIN_APPS_DEMO_ONLY) {
      const rows = getAdminAppsPlaceholderRows();
      if (gen !== loadGenRef.current) return null;
      setApps(rows);
      if (!silent && gen === loadGenRef.current) setLoading(false);
      return rows;
    }
    try {
      const raw = await adminDashboardApi.listAdminApps();
      if (gen !== loadGenRef.current) return null;
      const rows = (Array.isArray(raw) ? raw : [])
        .map(normalizeAdminAppRow)
        .filter(Boolean);
      setApps(rows);
      return rows;
    } catch (e) {
      if (gen !== loadGenRef.current) return null;
      if (!silent) {
        setApps([]);
        setError(
          e?.message ||
            "Could not load admin apps. Deploy GET /admin/apps or check admin session.",
        );
      }
      return null;
    } finally {
      if (!silent && gen === loadGenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const categories = useMemo(() => {
    const s = new Set();
    apps.forEach((a) => {
      if (a.category) s.add(a.category);
    });
    return ["ALL", ...Array.from(s).sort()];
  }, [apps]);

  const filteredSorted = useMemo(() => {
    let rows = [...apps];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) =>
        `${a.name} ${a.slug} ${a.description} ${a.category} ${a.id}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (statusFilter !== "ALL") rows = rows.filter((a) => a.status === statusFilter);
    if (visibilityFilter !== "ALL") {
      rows = rows.filter((a) => a.visibility === visibilityFilter);
    }
    if (categoryFilter !== "ALL") rows = rows.filter((a) => a.category === categoryFilter);
    rows.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
    return rows;
  }, [apps, search, statusFilter, visibilityFilter, categoryFilter, sortKey]);

  const resetPickersAndOpenCreate = () => {
    resetPickers();
    setEditorDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = (row) => {
    resetPickers();
    setEditorDraft({ ...row });
    setEditorOpen(true);
  };

  const toApiBody = (d) => ({
    name: d.name.trim(),
    slug: d.slug.trim() || undefined,
    description: d.description.trim(),
    category: d.category.trim() || "GENERAL",
    status: d.status,
    visibility: d.visibility,
    featured: Boolean(d.featured),
    routePath: d.routePath.trim() || undefined,
    externalUrl: d.externalUrl.trim() || undefined,
    version: d.version.trim() || "1.0.0",
    appUrl: computeCatalogAppUrlForApi(d),
  });

  const uploadAssets = async (appId, logoFile, bannerFile) => {
    if (ADMIN_APPS_DEMO_ONLY) return { ok: true };
    if (!logoFile && !bannerFile) return { ok: true };
    const fd = new FormData();
    if (logoFile) fd.append("logo", logoFile);
    if (bannerFile) fd.append("banner", bannerFile);
    const hadLogo = !!logoFile;
    const hadBanner = !!bannerFile;
    try {
      const res = await adminDashboardApi.uploadAdminAppAssets(appId, fd);
      logDevAppAssetUploadAudit(res, { appId, hadLogo, hadBanner });
      const verdict = evaluateAppAssetUploadResponse(res, { hadLogo, hadBanner });
      setApps((prev) =>
        prev.map((r) =>
          r.id === String(appId)
            ? mergeAssetResponseIntoRow(r, res, { hadLogo, hadBanner })
            : r,
        ),
      );
      await loadApps({ silent: true });
      if (!verdict.ok) {
        const parts = [];
        if (verdict.missingLogo) parts.push("logo");
        if (verdict.missingBanner) parts.push("banner");
        showError(
          `App saved, but ${parts.join(" and ")} upload did not return a stored URL. The file may not have been persisted on the server.`,
        );
      }
      return verdict;
    } catch (e) {
      if (e?.status === 404) {
        showError("Asset upload not available (POST /admin/apps/:id/assets).");
      } else {
        showError(e?.message || "Asset upload failed");
      }
      return { ok: false, error: true };
    }
  };

  const handleSaveEditor = async () => {
    const name = editorDraft.name.trim();
    if (!name) {
      showError("App name is required.");
      return;
    }
    const extOk = validateExternalUrl(editorDraft.externalUrl);
    if (!extOk.ok) {
      showError(extOk.message);
      return;
    }
    const routeOk = validateRoutePath(editorDraft.routePath);
    if (!routeOk.ok) {
      showError(routeOk.message);
      return;
    }
    if (!editorDraft.externalUrl.trim() && !editorDraft.routePath.trim()) {
      showError("Set an external URL and/or an internal route so users can open this app.");
      return;
    }

    setSaving(true);
    try {
      if (ADMIN_APPS_DEMO_ONLY) {
        const id =
          editorDraft.id ||
          `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rawRow = {
          id,
          name: editorDraft.name.trim(),
          slug: editorDraft.slug.trim(),
          description: editorDraft.description.trim(),
          category: editorDraft.category.trim() || "GENERAL",
          status: editorDraft.status,
          visibility: editorDraft.visibility,
          featured: editorDraft.featured,
          routePath: editorDraft.routePath.trim(),
          externalUrl: editorDraft.externalUrl.trim(),
          version: editorDraft.version.trim() || "1.0.0",
          logoUrl: (logoPickPreview || editorDraft.logoUrl || "").trim(),
          bannerUrl: (bannerPickPreview || editorDraft.bannerUrl || "").trim(),
          appUrl: computeCatalogAppUrlForApi(editorDraft),
          createdAt: editorDraft.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const normalized = normalizeAdminAppRow(rawRow);
        if (normalized) {
          setApps((prev) =>
            editorDraft.id
              ? prev.map((r) => (r.id === editorDraft.id ? normalized : r))
              : [...prev, normalized],
          );
        }
        showSuccess("Saved locally (demo catalog only).");
        closeEditor();
        return;
      }

      const body = toApiBody(editorDraft);
      const isNew = !editorDraft.id;
      let assetUploadOk = true;
      if (isNew) {
        const created = await adminDashboardApi.createAdminApp(body);
        const createdId = (() => {
          if (!created || typeof created !== "object" || Array.isArray(created)) return "";
          const id = created.id ?? created.appId ?? created.data?.id;
          return id != null && String(id).trim() ? String(id).trim() : "";
        })();
        const rows = await loadApps({ silent: true });
        let id = createdId;
        if (!id && Array.isArray(rows)) {
          const slug = String(body.slug || "").trim();
          const nm = String(body.name || "").trim();
          const hit =
            rows.find((r) => slug && r.slug === slug) ||
            rows.find((r) => r.name === nm) ||
            null;
          id = hit?.id ? String(hit.id) : "";
        }
        if (id && (pendingLogoFile || pendingBannerFile)) {
          const verdict = await uploadAssets(id, pendingLogoFile, pendingBannerFile);
          assetUploadOk = verdict?.ok !== false;
        }
        if (assetUploadOk) showSuccess("App created");
      } else {
        await adminDashboardApi.updateAdminApp(editorDraft.id, body);
        if (pendingLogoFile || pendingBannerFile) {
          const verdict = await uploadAssets(
            editorDraft.id,
            pendingLogoFile,
            pendingBannerFile,
          );
          assetUploadOk = verdict?.ok !== false;
        }
        if (assetUploadOk) showSuccess("App updated");
      }
      closeEditor();
      notifyCatalogMutated();
      await loadApps({ silent: true });
    } catch (e) {
      showError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget?.id) return;
    setRowBusyId(deleteTarget.id);
    try {
      if (ADMIN_APPS_DEMO_ONLY) {
        setApps((prev) => prev.filter((r) => r.id !== deleteTarget.id));
        showSuccess("Removed from demo list.");
        setDeleteTarget(null);
        return;
      }
      await adminDashboardApi.deleteAdminApp(deleteTarget.id);
      showSuccess("App deleted");
      setDeleteTarget(null);
      notifyCatalogMutated();
      await loadApps({ silent: true });
    } catch (e) {
      showError(e?.message || "Delete failed");
    } finally {
      setRowBusyId(null);
    }
  };

  const patchRow = async (row, partial) => {
    setRowBusyId(row.id);
    try {
      if (ADMIN_APPS_DEMO_ONLY) {
        const next = { ...row, ...partial, updatedAt: new Date().toISOString() };
        next.appUrl = computeCatalogAppUrlForApi(next);
        const normalized = normalizeAdminAppRow(next);
        if (normalized) {
          setApps((prev) => prev.map((r) => (r.id === row.id ? normalized : r)));
        }
        return;
      }
      await adminDashboardApi.updateAdminApp(row.id, {
        ...partial,
        appUrl: computeCatalogAppUrlForApi({ ...row, ...partial }),
      });
      notifyCatalogMutated();
      await loadApps({ silent: true });
    } catch (e) {
      showError(e?.message || "Update failed");
    } finally {
      setRowBusyId(null);
    }
  };

  const togglePublished = (row) => {
    const next = row.status === APP_STATUS.PUBLISHED ? APP_STATUS.DRAFT : APP_STATUS.PUBLISHED;
    void patchRow(row, { status: next });
  };

  const toggleFeatured = (row) => {
    void patchRow(row, { featured: !row.featured });
  };

  const previewApp = (row) => {
    void openUserCatalogApp(
      {
        appId: row.id,
        id: row.id,
        status: row.status,
        externalUrl: row.externalUrl,
        routePath: row.routePath,
        appUrl: row.appUrl || computeCatalogAppUrlForApi(row),
      },
      {
        navigate,
        applicationBackend,
        allowUnpublished: true,
      },
    );
  };

  const onLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    revokeIfBlob(logoPickPreview);
    const url = URL.createObjectURL(file);
    setLogoPickPreview(url);
    setPendingLogoFile(file);
    setEditorDraft((d) => ({ ...d, logoUrl: "" }));
  };

  const onBannerFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    revokeIfBlob(bannerPickPreview);
    const url = URL.createObjectURL(file);
    setBannerPickPreview(url);
    setPendingBannerFile(file);
    setEditorDraft((d) => ({ ...d, bannerUrl: "" }));
  };

  const logoDisplay = logoPickPreview || resolveAppMediaUrl(editorDraft.logoUrl);
  const bannerDisplay = bannerPickPreview || resolveAppMediaUrl(editorDraft.bannerUrl);

  return (
    <section className="content-grid one-column admin-apps-root">
      <article className="panel apps-manager-shell">
        <div className="panel-head apps-manager-head">
          <div>
            <h3>App management</h3>
            <p>Create, publish, and configure catalog apps (internal routes and external links).</p>
            {ADMIN_APPS_DEMO_ONLY ? (
              <p className="admin-apps-pending-banner" role="status">
                <span className="admin-apps-pending-badge">Demo mode</span>
                Placeholder catalog only — set <code>VITE_ADMIN_APPS_DEMO_ONLY=false</code> (default) to call live{" "}
                <code>/admin/apps</code> APIs.
              </p>
            ) : null}
          </div>
          <div className="admin-apps-head-actions">
            <button type="button" className="secondary-btn" onClick={() => void loadApps()} disabled={loading}>
              Retry / refresh
            </button>
            <button type="button" className="primary-btn" onClick={resetPickersAndOpenCreate}>
              New app
            </button>
          </div>
        </div>

        <div className="admin-apps-toolbar">
          <input
            type="search"
            className="admin-apps-search"
            placeholder="Search name, slug, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search apps"
          />
          <select
            className="admin-apps-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="ALL">All statuses</option>
            {Object.values(APP_STATUS).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="admin-apps-select"
            value={visibilityFilter}
            onChange={(e) => setVisibilityFilter(e.target.value)}
            aria-label="Filter by visibility"
          >
            <option value="ALL">All visibility</option>
            <option value={VISIBILITY.PUBLIC}>PUBLIC</option>
            <option value={VISIBILITY.PRIVATE}>PRIVATE</option>
          </select>
          <select
            className="admin-apps-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === "ALL" ? "All categories" : c}
              </option>
            ))}
          </select>
          <select
            className="admin-apps-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            aria-label="Sort"
          >
            <option value="updated">Sort: recently updated</option>
            <option value="name">Sort: name (A–Z)</option>
          </select>
          <div className="admin-apps-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={viewMode === "table" ? "is-on" : ""}
              onClick={() => setViewMode("table")}
            >
              Table
            </button>
            <button
              type="button"
              className={viewMode === "cards" ? "is-on" : ""}
              onClick={() => setViewMode("cards")}
            >
              Cards
            </button>
          </div>
        </div>

        {loading ? (
          <div className="admin-apps-skeleton" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="admin-apps-skel-row" />
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <div className="admin-apps-banner-error" role="alert">
            <p>{error}</p>
            <button type="button" className="secondary-btn" onClick={() => void loadApps()}>
              Try again
            </button>
          </div>
        ) : null}

        {!loading && !error && filteredSorted.length === 0 ? (
          <div className="admin-apps-empty" role="status">
            <p>No apps match the current filters.</p>
            <button type="button" className="primary-btn" onClick={resetPickersAndOpenCreate}>
              Create the first app
            </button>
          </div>
        ) : null}

        {!loading && !error && viewMode === "table" && filteredSorted.length > 0 ? (
          <div className="table-wrap apps-table-wrap">
            <table className="apps-management-table admin-apps-table">
              <thead>
                <tr>
                  <th>Logo</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>Featured</th>
                  <th>Version</th>
                  <th>Route</th>
                  <th>External</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <div className="apps-logo-cell">
                        {app.logoUrl ? (
                          <AppCatalogLogo src={app.logoUrl} name={app.name} size={36} />
                        ) : (
                          <span>{app.name.slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="admin-apps-namecell">
                        <strong>{app.name}</strong>
                        <small className="admin-apps-muted">{app.slug}</small>
                      </div>
                    </td>
                    <td>{app.category}</td>
                    <td>
                      <label className="admin-apps-toggle">
                        <input
                          type="checkbox"
                          checked={app.status === APP_STATUS.PUBLISHED}
                          disabled={rowBusyId === app.id}
                          onChange={() => togglePublished(app)}
                        />
                        <span>{app.status === APP_STATUS.PUBLISHED ? "Published" : "Draft"}</span>
                      </label>
                    </td>
                    <td>
                      <select
                        className="admin-apps-inline-select"
                        value={app.visibility}
                        disabled={rowBusyId === app.id}
                        onChange={(e) => void patchRow(app, { visibility: e.target.value })}
                      >
                        <option value={VISIBILITY.PUBLIC}>PUBLIC</option>
                        <option value={VISIBILITY.PRIVATE}>PRIVATE</option>
                      </select>
                    </td>
                    <td>
                      <label className="admin-apps-toggle">
                        <input
                          type="checkbox"
                          checked={app.featured}
                          disabled={rowBusyId === app.id}
                          onChange={() => toggleFeatured(app)}
                        />
                        <span>{app.featured ? "Yes" : "No"}</span>
                      </label>
                    </td>
                    <td>{app.version}</td>
                    <td className="admin-apps-mono">{app.routePath || "—"}</td>
                    <td className="admin-apps-mono admin-apps-clip">{app.externalUrl || "—"}</td>
                    <td className="apps-actions-cell">
                      <button type="button" className="users-row-action users-row-edit" onClick={() => openEdit(app)}>
                        Edit
                      </button>
                      <button type="button" className="users-row-action users-row-edit" onClick={() => previewApp(app)}>
                        Preview
                      </button>
                      <button
                        type="button"
                        className="users-row-action users-row-toggle deactivate"
                        onClick={() => setDeleteTarget(app)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && !error && viewMode === "cards" && filteredSorted.length > 0 ? (
          <div className="admin-apps-cards">
            {filteredSorted.map((app) => (
              <article key={app.id} className="admin-apps-card">
                <div className="admin-apps-card-head">
                  <div className="apps-logo-cell admin-apps-card-logo">
                    {app.logoUrl ? (
                      <AppCatalogLogo src={app.logoUrl} name={app.name} size={40} />
                    ) : (
                      <span>{app.name.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <h4>{app.name}</h4>
                    <p className="admin-apps-muted">
                      {app.category} · {app.status}
                    </p>
                  </div>
                </div>
                <p className="admin-apps-card-desc">{app.description || "—"}</p>
                <div className="admin-apps-card-actions">
                  <button type="button" className="secondary-btn" onClick={() => openEdit(app)}>
                    Edit
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => previewApp(app)}>
                    Preview
                  </button>
                  <button
                    type="button"
                    className="users-row-action users-row-toggle deactivate"
                    onClick={() => setDeleteTarget(app)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <p className="admin-apps-footnote">
          {!ADMIN_APPS_DEMO_ONLY ? (
            <>
              Live catalog: GET/POST/PATCH/DELETE <code>/admin/apps</code> and POST <code>/admin/apps/:id/assets</code>.
              Optional pagination: pass <code>page</code> and <code>size</code> via <code>listAdminApps</code> when the
              backend supports it.
            </>
          ) : (
            <>
              Demo-only: set <code>VITE_ADMIN_APPS_DEMO_ONLY=false</code> (or remove it) to use live admin apps APIs.
            </>
          )}
        </p>
      </article>

      {editorOpen ? (
        <div
          className="admin-apps-drawer-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) closeEditor();
          }}
        >
          <aside
            className="admin-apps-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-app-editor-title"
          >
            <div className="admin-apps-drawer-head">
              <h4 id="admin-app-editor-title">{editorDraft.id ? "Edit app" : "New app"}</h4>
              <button type="button" className="secondary-btn" onClick={() => !saving && closeEditor()} disabled={saving}>
                Close
              </button>
            </div>
            <div className="admin-apps-drawer-body">
              <label className="admin-apps-label">Name</label>
              <input
                value={editorDraft.name}
                onChange={(e) => setEditorDraft((d) => ({ ...d, name: e.target.value }))}
              />

              <label className="admin-apps-label">Slug (optional)</label>
              <input
                value={editorDraft.slug}
                onChange={(e) => setEditorDraft((d) => ({ ...d, slug: e.target.value }))}
                placeholder="auto-from-name if empty"
              />

              <label className="admin-apps-label">Description</label>
              <textarea
                rows={3}
                value={editorDraft.description}
                onChange={(e) => setEditorDraft((d) => ({ ...d, description: e.target.value }))}
              />

              <label className="admin-apps-label">Category</label>
              <input
                value={editorDraft.category}
                onChange={(e) => setEditorDraft((d) => ({ ...d, category: e.target.value }))}
              />

              <div className="admin-apps-two">
                <div>
                  <label className="admin-apps-label">Status</label>
                  <select
                    value={editorDraft.status}
                    onChange={(e) => setEditorDraft((d) => ({ ...d, status: e.target.value }))}
                  >
                    {Object.values(APP_STATUS).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="admin-apps-label">Visibility</label>
                  <select
                    value={editorDraft.visibility}
                    onChange={(e) => setEditorDraft((d) => ({ ...d, visibility: e.target.value }))}
                  >
                    <option value={VISIBILITY.PUBLIC}>PUBLIC</option>
                    <option value={VISIBILITY.PRIVATE}>PRIVATE</option>
                  </select>
                </div>
              </div>

              <label className="admin-apps-label">
                <input
                  type="checkbox"
                  checked={editorDraft.featured}
                  onChange={(e) => setEditorDraft((d) => ({ ...d, featured: e.target.checked }))}
                />{" "}
                Featured
              </label>

              <label className="admin-apps-label">Version</label>
              <input
                value={editorDraft.version}
                onChange={(e) => setEditorDraft((d) => ({ ...d, version: e.target.value }))}
              />

              <label className="admin-apps-label">Internal route (SPA)</label>
              <input
                value={editorDraft.routePath}
                onChange={(e) => setEditorDraft((d) => ({ ...d, routePath: e.target.value }))}
                placeholder="/apps/example"
              />

              <label className="admin-apps-label">External URL</label>
              <input
                value={editorDraft.externalUrl}
                onChange={(e) => setEditorDraft((d) => ({ ...d, externalUrl: e.target.value }))}
                placeholder="https://example.com"
              />

              <div className="admin-apps-two">
                <div>
                  <label className="admin-apps-label">Logo</label>
                  <input ref={logoPickRef} type="file" accept="image/*" onChange={onLogoFile} />
                  <div className="admin-apps-thumb">
                    {logoDisplay ? (
                      <img
                        src={logoDisplay}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <span>No logo</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="admin-apps-label">Banner</label>
                  <input ref={bannerPickRef} type="file" accept="image/*" onChange={onBannerFile} />
                  <div className="admin-apps-thumb admin-apps-thumb-wide">
                    {bannerDisplay ? (
                      <img
                        src={bannerDisplay}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <span>No banner</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="admin-apps-drawer-foot">
              <button type="button" className="secondary-btn" onClick={() => !saving && closeEditor()} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="primary-btn" onClick={() => void handleSaveEditor()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="admin-apps-drawer-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div className="admin-apps-modal" role="dialog" aria-modal="true">
            <h4>Delete app?</h4>
            <p className="admin-apps-muted">
              This will remove <strong>{deleteTarget.name}</strong> from the catalog for users (requires DELETE
              /admin/apps/:id).
            </p>
            <div className="admin-apps-modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="users-row-action users-row-toggle deactivate"
                disabled={rowBusyId === deleteTarget.id}
                onClick={() => void handleDeleteConfirm()}
              >
                {rowBusyId === deleteTarget.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
