import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchKycDocumentAccessUrl,
  KYC_DOCUMENT_ACCESS_MAX_ATTEMPTS,
} from "../utils/kycDocumentAccess";
import {
  isPresignedS3Url,
  isPrivateS3DocumentUrl,
  resolveKycDocumentUrl,
} from "../utils/mediaUrl";

/**
 * Resolve KYC document URLs for previews and download links.
 * S3 objects always use short-lived presigned URLs from document-access APIs.
 *
 * @param {string} storedUrl
 * @param {{ admin?: boolean }} [opts]
 */
export function useKycAccessibleUrl(storedUrl, opts = {}) {
  const { admin = false } = opts;
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [fetchAttempt, setFetchAttempt] = useState(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setFetchAttempt(0);
    setUrl("");
    setStatus("idle");
  }, [storedUrl, admin]);

  const canRetry = fetchAttempt < KYC_DOCUMENT_ACCESS_MAX_ATTEMPTS - 1;

  const retry = useCallback(() => {
    if (!canRetry) return;
    setFetchAttempt((n) => n + 1);
  }, [canRetry]);

  const refreshOnExpired = useCallback(() => {
    if (inFlightRef.current || !canRetry) return;
    setFetchAttempt((n) => n + 1);
  }, [canRetry]);

  useEffect(() => {
    const raw = String(storedUrl ?? "").trim();
    if (!raw) {
      setUrl("");
      setStatus("idle");
      return;
    }

    if (isPresignedS3Url(raw)) {
      setUrl(raw);
      setStatus("ready");
      return;
    }

    if (!isPrivateS3DocumentUrl(raw)) {
      const resolved = resolveKycDocumentUrl(raw);
      setUrl(resolved);
      setStatus(resolved ? "ready" : "error");
      return;
    }

    if (fetchAttempt >= KYC_DOCUMENT_ACCESS_MAX_ATTEMPTS) {
      setUrl("");
      setStatus("error");
      return;
    }

    let cancelled = false;
    inFlightRef.current = true;
    setStatus("loading");
    setUrl("");

    fetchKycDocumentAccessUrl(raw, { admin })
      .then((resolved) => {
        if (cancelled) return;
        inFlightRef.current = false;
        setUrl(resolved);
        setStatus(resolved ? "ready" : "error");
      })
      .catch(() => {
        if (cancelled) return;
        inFlightRef.current = false;
        setUrl("");
        setStatus("error");
      });

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [storedUrl, admin, fetchAttempt]);

  return { url, status, retry, refreshOnExpired, canRetry, fetchAttempt };
}
