import { useKycAccessibleUrl } from "../hooks/useKycAccessibleUrl";

export default function KycDocumentLink({
  storedUrl,
  className = "",
  children = "View / Download",
  admin = false,
}) {
  const { url, status, retry, canRetry } = useKycAccessibleUrl(storedUrl, { admin });

  if (status === "loading") {
    return (
      <span className={className} role="status">
        Loading document…
      </span>
    );
  }

  if (status === "error" || !url) {
    return (
      <span className={className} role="status">
        Document unavailable
        {canRetry ? (
          <>
            {" "}
            <button type="button" className="pf-btn pf-btn--ghost" onClick={retry}>
              Retry
            </button>
          </>
        ) : null}
      </span>
    );
  }

  return (
    <a className={className} href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
