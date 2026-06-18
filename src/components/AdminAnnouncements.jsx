import { useCallback, useEffect, useRef, useState } from "react";
import { announcementsApi } from "../services/announcementsApi";
import { resolveMediaUrl } from "../utils/mediaUrl";
import { showError, showSuccess } from "../services/toast";
import "./AdminAnnouncements.css";

function emptyDraft() {
  return {
    id: "",
    title: "",
    body: "",
    icon: "📣",
    published: true,
    bannerUrl: "",
  };
}

export default function AdminAnnouncements() {
  const loadGenRef = useRef(0);
  const bannerPickRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [rowBusyId, setRowBusyId] = useState(null);
  const [pendingBannerFile, setPendingBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState("");

  const loadRows = useCallback(async (opts = {}) => {
    const silent = Boolean(opts.silent);
    const gen = ++loadGenRef.current;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const list = await announcementsApi.listAdmin();
      if (gen !== loadGenRef.current) return;
      setRows(list);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setError(e?.message || "Could not load announcements.");
      if (!silent) setRows([]);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const resetBannerPick = useCallback(() => {
    if (bannerPreview && bannerPreview.startsWith("blob:")) {
      URL.revokeObjectURL(bannerPreview);
    }
    setBannerPreview("");
    setPendingBannerFile(null);
    if (bannerPickRef.current) bannerPickRef.current.value = "";
  }, [bannerPreview]);

  const closeEditor = useCallback(() => {
    resetBannerPick();
    setEditorOpen(false);
    setDraft(emptyDraft());
  }, [resetBannerPick]);

  const openCreate = () => {
    resetBannerPick();
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = (row) => {
    resetBannerPick();
    setDraft({
      id: row.id,
      title: row.title,
      body: row.body,
      icon: row.icon || "📣",
      published: row.published !== false,
      bannerUrl: row.bannerUrl || "",
    });
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const title = String(draft.title || "").trim();
    const body = String(draft.body || "").trim();
    if (!title) {
      showError("Title is required.");
      return;
    }
    if (!body) {
      showError("Message is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title,
        body,
        icon: String(draft.icon || "📣").trim() || "📣",
        published: Boolean(draft.published),
      };
      let savedId = draft.id;
      if (draft.id) {
        await announcementsApi.update(draft.id, payload);
        showSuccess("Announcement updated");
      } else {
        const created = await announcementsApi.create(payload);
        savedId = created?.id ?? created?.data?.id ?? "";
        showSuccess("Announcement created");
      }
      if (pendingBannerFile && savedId) {
        await announcementsApi.uploadAsset(savedId, pendingBannerFile);
      }
      closeEditor();
      await loadRows({ silent: true });
    } catch (e) {
      showError(e?.message || "Could not save announcement.");
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (row) => {
    if (rowBusyId) return;
    setRowBusyId(row.id);
    try {
      await announcementsApi.update(row.id, {
        published: !row.published,
        body: row.body,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, published: !row.published } : r,
        ),
      );
      showSuccess(row.published ? "Unpublished" : "Published");
    } catch (e) {
      showError(e?.message || "Could not update status.");
      void loadRows({ silent: true });
    } finally {
      setRowBusyId(null);
    }
  };

  const handleDelete = async (row) => {
    if (rowBusyId) return;
    if (!window.confirm(`Delete "${row.title}"?`)) return;
    setRowBusyId(row.id);
    try {
      await announcementsApi.remove(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      showSuccess("Announcement deleted");
    } catch (e) {
      showError(e?.message || "Could not delete announcement.");
    } finally {
      setRowBusyId(null);
    }
  };

  return (
    <section className="content-grid one-column admin-announcements">
      <article className="panel">
        <div className="panel-head admin-ann-head">
          <div>
            <h3>Announcements</h3>
            <p className="panel-note">Publish updates shown in the user dashboard &quot;What&apos;s New&quot; section.</p>
          </div>
          <button type="button" className="users-export-btn" onClick={openCreate}>
            New announcement
          </button>
        </div>

        {error ? <p className="empty-state">{error}</p> : null}

        <div className="table-wrap">
          <table className="users-management-table users-management-table--saas">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Preview</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length
                ? Array.from({ length: 4 }).map((_, i) => (
                    <tr key={`ann-sk-${i}`} aria-hidden>
                      <td colSpan={4}>
                        <span className="skeleton sk-line sk-block sk-w-80" />
                      </td>
                    </tr>
                  ))
                : null}
              {!loading && !rows.length && !error ? (
                <tr>
                  <td colSpan={4} className="empty-table-row">
                    No announcements yet. Create one to show in the user dashboard.
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.icon} {row.title}</strong>
                    {row.body ? <div className="admin-ann-body-preview">{row.body}</div> : null}
                  </td>
                  <td>
                    {row.bannerUrl ? (
                      <img
                        className="admin-ann-thumb"
                        src={resolveMediaUrl(row.bannerUrl)}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="admin-ann-no-banner">No banner</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`status-badge users-status-pill ${row.published ? "active" : "inactive"}`}
                    >
                      {row.published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="users-actions-cell">
                    <button
                      type="button"
                      className="users-row-action users-row-edit"
                      disabled={rowBusyId === row.id}
                      onClick={() => openEdit(row)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="users-row-action users-row-toggle"
                      disabled={rowBusyId === row.id}
                      onClick={() => void togglePublished(row)}
                    >
                      {row.published ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      type="button"
                      className="users-row-action users-row-toggle deactivate"
                      disabled={rowBusyId === row.id}
                      onClick={() => void handleDelete(row)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {editorOpen ? (
        <div
          className="kyc-mod-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEditor();
          }}
        >
          <div className="kyc-mod-modal admin-ann-modal" role="dialog" aria-modal="true">
            <h4>{draft.id ? "Edit announcement" : "New announcement"}</h4>
            <label className="kyc-mod-label" htmlFor="ann-title">
              Title
            </label>
            <input
              id="ann-title"
              className="users-control-input admin-ann-input"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
            <label className="kyc-mod-label" htmlFor="ann-body">
              Message
            </label>
            <textarea
              id="ann-body"
              className="kyc-mod-textarea"
              rows={4}
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            />
            <label className="kyc-mod-label" htmlFor="ann-icon">
              Icon (emoji)
            </label>
            <input
              id="ann-icon"
              className="users-control-input admin-ann-input admin-ann-input--icon"
              value={draft.icon}
              onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
            />
            <label className="kyc-mod-label">
              <input
                type="checkbox"
                checked={draft.published}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, published: e.target.checked }))
                }
              />{" "}
              Published
            </label>
            <label className="kyc-mod-label" htmlFor="ann-banner">
              Banner image
            </label>
            <input
              id="ann-banner"
              ref={bannerPickRef}
              type="file"
              accept="image/*"
              className="pf-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                resetBannerPick();
                setPendingBannerFile(file);
                setBannerPreview(URL.createObjectURL(file));
              }}
            />
            {(bannerPreview || draft.bannerUrl) && (
              <img
                className="admin-ann-banner-preview"
                src={bannerPreview || resolveMediaUrl(draft.bannerUrl)}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <div className="kyc-mod-modal-actions">
              <button type="button" className="users-page-btn" onClick={closeEditor}>
                Cancel
              </button>
              <button
                type="button"
                className="users-row-action users-row-edit"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
