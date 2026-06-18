import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useKycAccessibleUrl } from "../hooks/useKycAccessibleUrl";
import {
  getAdminKycDocumentPreviewSlots,
  hasKycDocumentCandidates,
} from "../utils/kycAdmin";
import { KYC_DOCUMENT_URL_KEYS } from "../utils/kycDocumentCandidates";
import "./AdminKycDocPreviews.css";

const DEV_KYC_PREVIEW_AUDIT =
  import.meta.env.DEV && import.meta.env.VITE_KYC_PREVIEW_AUDIT !== "false";

/** Set VITE_KYC_FORCE_IMG_VISIBLE=true to bypass opacity (confirms CSS-state bug). */
const FORCE_IMG_VISIBLE = import.meta.env.VITE_KYC_FORCE_IMG_VISIBLE === "true";

function auditKycPreview(label, payload) {
  if (!DEV_KYC_PREVIEW_AUDIT) return;
  const meta =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { keys: Object.keys(payload) }
      : { type: Array.isArray(payload) ? "array" : typeof payload };
  // eslint-disable-next-line no-console
  console.debug(`[kyc-preview] ${label}`, meta);
}

function probeImageReady(img) {
  if (!img) return false;
  return Boolean(img.complete && img.naturalWidth > 0);
}

const DocSlot = memo(function DocSlot({ slot }) {
  const storedUrl = slot.storedUrl || slot.url;
  const {
    url: displayUrl,
    status: accessStatus,
    retry,
    refreshOnExpired,
    canRetry,
  } = useKycAccessibleUrl(storedUrl, { admin: true });

  const [phase, setPhase] = useState("loading");
  const [imgRetry, setImgRetry] = useState(0);
  const imgRef = useRef(null);
  const phaseRef = useRef(phase);
  const expiredRefreshRef = useRef(false);
  phaseRef.current = phase;

  const logPhase = useCallback(
    (next, meta = {}) => {
      auditKycPreview("phase", {
        from: phaseRef.current,
        to: next,
        label: slot.label,
        ...meta,
      });
      setPhase(next);
    },
    [slot.label],
  );

  const tryMarkReady = useCallback(
    (img, source) => {
      if (!img || !displayUrl) return false;
      const ready = probeImageReady(img);
      auditKycPreview("probe", { source, ready, phase: phaseRef.current });
      if (ready) {
        logPhase("ready", { source });
        return true;
      }
      return false;
    },
    [displayUrl, logPhase],
  );

  const imgCallbackRef = useCallback(
    (node) => {
      imgRef.current = node;
      if (!node || !displayUrl) return;
      if (tryMarkReady(node, "ref-callback")) return;
      logPhase("loading", { source: "ref-callback" });
    },
    [displayUrl, tryMarkReady, logPhase],
  );

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img || !displayUrl) return;
    tryMarkReady(img, "layout-effect");
  }, [displayUrl, imgRetry, tryMarkReady]);

  useEffect(() => {
    if (!displayUrl) {
      if (accessStatus === "error") logPhase("error", { source: "access-denied" });
      return;
    }
    expiredRefreshRef.current = false;
    logPhase("loading", { source: "url-resolved" });
  }, [displayUrl, accessStatus, logPhase]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !displayUrl) return;
    const t = window.setTimeout(() => {
      if (phaseRef.current !== "loading") return;
      tryMarkReady(img, "delayed-probe-50ms");
    }, 50);
    return () => window.clearTimeout(t);
  }, [displayUrl, imgRetry, tryMarkReady]);

  const bumpRetry = useCallback(() => {
    if (!canRetry) return;
    expiredRefreshRef.current = false;
    logPhase("loading", { source: "retry" });
    retry();
    setImgRetry((n) => n + 1);
  }, [canRetry, logPhase, retry]);

  const handleImgLoad = useCallback(() => {
    logPhase("ready", { source: "onLoad" });
  }, [logPhase]);

  const handleImgError = useCallback(() => {
    if (!expiredRefreshRef.current && canRetry) {
      expiredRefreshRef.current = true;
      logPhase("loading", { source: "expired-presign-refresh" });
      refreshOnExpired();
      setImgRetry((n) => n + 1);
      return;
    }
    logPhase("error", { source: "onError" });
  }, [canRetry, logPhase, refreshOnExpired]);

  const accessBlocked = accessStatus === "error" && !displayUrl;
  const accessLoading = accessStatus === "loading" || (!displayUrl && accessStatus !== "error");

  if (slot.kind === "pdf") {
    return (
      <article className="kyc-doc-slot kyc-doc-slot--pdf">
        <h6 className="kyc-doc-slot-title">{slot.label}</h6>
        <div className="kyc-doc-slot-pdf-badge" aria-hidden>
          PDF
        </div>
        <p className="kyc-doc-slot-hint">Inline preview is not available for PDF. Open in a new tab to review.</p>
        <div className="kyc-doc-slot-actions">
          {displayUrl ? (
            <>
              <a className="kyc-doc-slot-btn" href={displayUrl} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
              <a className="kyc-doc-slot-btn kyc-doc-slot-btn--ghost" href={displayUrl} download rel="noreferrer">
                Download
              </a>
            </>
          ) : (
            <span className="kyc-doc-slot-hint" role="status">
              {accessBlocked
                ? "Document preview unavailable. Try again or refresh the application."
                : "Loading secure link…"}
            </span>
          )}
          {accessBlocked && canRetry ? (
            <button type="button" className="kyc-doc-slot-btn" onClick={bumpRetry}>
              Retry
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  const showBroken = phase === "error" || accessBlocked;
  const showReady = phase === "ready" || FORCE_IMG_VISIBLE;
  const showSkeleton = (phase === "loading" || accessLoading) && !FORCE_IMG_VISIBLE && !showBroken;
  const imgClassName = [
    "kyc-doc-slot-img",
    showReady ? "kyc-doc-slot-img--visible" : "",
    FORCE_IMG_VISIBLE ? "kyc-doc-slot-img--force-visible" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className="kyc-doc-slot kyc-doc-slot--image">
      <h6 className="kyc-doc-slot-title">{slot.label}</h6>
      <div className="kyc-doc-slot-frame">
        {showSkeleton ? <div className="kyc-doc-slot-skeleton" aria-hidden /> : null}
        {showBroken ? (
          <div className="kyc-doc-slot-broken" role="alert">
            <span>Could not load image preview.</span>
            <div className="kyc-doc-slot-broken-actions">
              {canRetry ? (
                <button type="button" className="kyc-doc-slot-btn" onClick={bumpRetry}>
                  Retry
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {displayUrl && !showBroken ? (
          <img
            ref={imgCallbackRef}
            key={`${slot.id}-${imgRetry}-${displayUrl}`}
            src={displayUrl}
            alt=""
            loading="eager"
            decoding="async"
            className={imgClassName}
            onLoad={handleImgLoad}
            onError={handleImgError}
          />
        ) : null}
      </div>
      <div className="kyc-doc-slot-actions">
        {displayUrl ? (
          <>
            <a className="kyc-doc-slot-btn" href={displayUrl} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
            <a className="kyc-doc-slot-btn kyc-doc-slot-btn--ghost" href={displayUrl} download rel="noreferrer">
              Download
            </a>
          </>
        ) : (
          <span className="kyc-doc-slot-hint" role="status">
            {accessBlocked
              ? "Document preview unavailable."
              : "Loading secure link…"}
          </span>
        )}
      </div>
    </article>
  );
});

function kycRowDocFingerprint(row) {
  if (!row || typeof row !== "object") return "";
  const raw = row._raw && typeof row._raw === "object" ? row._raw : {};
  const keys = KYC_DOCUMENT_URL_KEYS;
  const parts = keys.map((k) => String(row[k] ?? raw[k] ?? ""));
  const docLists = ["documents", "kycDocuments", "kycDocumentUrls"].map((k) => {
    const arr = row[k] ?? raw[k];
    return Array.isArray(arr) ? arr.length : 0;
  });
  return `${parts.join("\0")}|${docLists.join(",")}`;
}

function AdminKycDocPreviews({ row }) {
  const docFingerprint = useMemo(() => kycRowDocFingerprint(row), [row]);
  const slots = useMemo(
    () => getAdminKycDocumentPreviewSlots(row),
    [row, docFingerprint],
  );

  useEffect(() => {
    auditKycPreview("preview slots", {
      rowId: row?.id,
      slotCount: slots.length,
      slots: slots.map((s) => ({ label: s.label, kind: s.kind, needsPresign: s.needsPresign })),
    });
  }, [row?.id, slots]);

  if (!slots.length) {
    const hasRawDocs = hasKycDocumentCandidates(row);
    return (
      <section className="kyc-doc-preview-root" aria-label="KYC documents">
        <h5 className="kyc-doc-preview-heading">Verification documents</h5>
        <p className="kyc-doc-preview-empty" role="status">
          {hasRawDocs
            ? "Documents were found but secure preview could not be prepared. Retry or refresh this application."
            : "No document URLs were returned for this application."}
        </p>
      </section>
    );
  }

  return (
    <section className="kyc-doc-preview-root" aria-label="KYC documents">
      <h5 className="kyc-doc-preview-heading">Verification documents</h5>
      <p className="kyc-doc-preview-sub">Review each file before verify or reject. PDFs open externally.</p>
      <div className="kyc-doc-preview-grid">
        {slots.map((slot) => (
          <DocSlot key={slot.id} slot={slot} />
        ))}
      </div>
    </section>
  );
}

export default memo(AdminKycDocPreviews);
