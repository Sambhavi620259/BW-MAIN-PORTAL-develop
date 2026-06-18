import { useKycAccessibleUrl } from "../hooks/useKycAccessibleUrl";

const thumbStyle = {
  width: "120px",
  height: "80px",
  objectFit: "cover",
  borderRadius: "8px",
  border: "1px solid #ddd",
};

const pdfBadgeStyle = {
  width: "120px",
  height: "80px",
  border: "1px solid #ddd",
  borderRadius: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "36px",
};

function isPdfUrl(value) {
  return String(value ?? "").toLowerCase().includes(".pdf");
}

export default function KycDocumentPreview({ storedUrl, admin = false }) {
  const { url, status, retry, canRetry } = useKycAccessibleUrl(storedUrl, { admin });

  if (status === "loading") {
    return (
      <div className="pf-value" role="status">
        Loading preview…
      </div>
    );
  }

  if (status === "error" || !url) {
    return (
      <div className="pf-value" role="status">
        Preview unavailable
        {canRetry ? (
          <>
            {" "}
            <button type="button" className="pf-btn pf-btn--ghost" onClick={retry}>
              Retry
            </button>
          </>
        ) : null}
      </div>
    );
  }

  if (isPdfUrl(storedUrl) || isPdfUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <div style={pdfBadgeStyle} aria-hidden>
          📄
        </div>
      </a>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="KYC Document" style={thumbStyle} />
    </a>
  );
}
