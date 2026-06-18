import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo";
import { authBackend } from "../services/backendApis";
import { getApiErrorMessage } from "../services/backendClient";
import { showError, showSuccess } from "../services/toast";

/**
 * Maps backend errors to UX buckets. Wording stays generic until the server returns specifics.
 * @param {unknown} err
 * @returns {{ kind: "invalid" | "expired" | "already" | "generic"; title: string; body: string }}
 */
function classifyVerifyEmailError(err) {
  const status = err?.status;
  const msg = getApiErrorMessage(err, "");
  const lower = msg.toLowerCase();

  if (lower.includes("already") && (lower.includes("verified") || lower.includes("verify"))) {
    return {
      kind: "already",
      title: "Already verified",
      body:
        msg ||
        "This email address has already been verified. You can sign in with your email and password.",
    };
  }
  if (
    status === 410 ||
    lower.includes("expired") ||
    lower.includes("expiration")
  ) {
    return {
      kind: "expired",
      title: "Link expired",
      body:
        msg ||
        "This verification link has expired. If you still need access, register again or contact support.",
    };
  }
  if (
    status === 404 ||
    lower.includes("invalid token") ||
    lower.includes("invalid link") ||
    (lower.includes("not found") && (lower.includes("token") || lower.includes("user")))
  ) {
    return {
      kind: "invalid",
      title: "Invalid or unknown link",
      body:
        msg ||
        "This verification link is invalid or no longer active. Check the link in your email or request a new one.",
    };
  }
  if (status === 400 || status === 422) {
    return {
      kind: "invalid",
      title: "Verification failed",
      body: msg || "The verification link could not be accepted. It may be corrupted or incomplete.",
    };
  }
  return {
    kind: "generic",
    title: "Could not verify email",
    body:
      msg ||
      "Email verification could not be completed. Try again in a moment, or sign in if you already verified your account.",
  };
}

function bannerStyle(kind) {
  if (kind === "success") {
    return {
      background: "#ecfdf5",
      border: "1px solid #6ee7b7",
      color: "#065f46",
    };
  }
  if (kind === "already") {
    return {
      background: "#eef2ff",
      border: "1px solid #c7d2fe",
      color: "#3730a3",
    };
  }
  return {
    background: "#fff1f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
  };
}

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();

  const [phase, setPhase] = useState("loading"); // loading | missing_token | success | error
  const [successMessage, setSuccessMessage] = useState("");
  const [errorBlock, setErrorBlock] = useState({
    kind: "generic",
    title: "",
    body: "",
  });

  useEffect(() => {
    const raw = searchParams.get("token");
    const token = typeof raw === "string" ? raw.trim() : "";

    if (!token) {
      setPhase("missing_token");
      setErrorBlock({
        kind: "invalid",
        title: "Missing verification link",
        body:
          "No token was found in the address bar. Open the full link from your registration email, or paste the link exactly as received.",
      });
      return;
    }

    let cancelled = false;

    (async () => {
      setPhase("loading");
      try {
        const data = await authBackend.verifyEmailByToken(token);
        if (cancelled) return;

        const hint =
          data && typeof data === "object" && !Array.isArray(data)
            ? String(data.message ?? data.data?.message ?? "").trim()
            : "";
        const line =
          hint || "Your email is verified. Continue to sign in, then complete OTP verification.";
        setSuccessMessage(line);
        setPhase("success");
        showSuccess("Email verified");
      } catch (e) {
        if (cancelled) return;
        const classified = classifyVerifyEmailError(e);
        setErrorBlock(classified);
        setPhase("error");
        showError(classified.body);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const outer = {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 18,
    background:
      "radial-gradient(circle at top right, rgba(37,99,235,0.16), transparent 50%), radial-gradient(circle at bottom left, rgba(14,165,233,0.12), transparent 45%), linear-gradient(135deg, #f8fbff 0%, #eef2ff 40%, #ffffff 100%)",
  };

  const card = {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(37,99,235,0.14)",
    boxShadow: "0 28px 70px rgba(15,23,42,0.18)",
    borderRadius: 18,
    padding: 22,
    backdropFilter: "blur(10px)",
  };

  return (
    <div style={outer}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "center" }}>
          <Logo to="/login" showText />
        </div>

        <div style={card}>
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.2px" }}>
              {phase === "loading"
                ? "Verifying your email"
                : phase === "success"
                  ? "Email verified"
                  : phase === "missing_token"
                    ? "Verification link incomplete"
                    : errorBlock.title}
            </h1>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
              {phase === "loading"
                ? "Confirming your registration link with the server…"
                : phase === "success"
                  ? "You can continue to login."
                  : phase === "missing_token"
                    ? "We could not read a verification token from this page."
                    : "We could not complete verification from this link."}
            </p>
          </div>

          {phase === "loading" ? (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                background: "#f8fafc",
                border: "1px solid rgba(148,163,184,0.35)",
                color: "#475569",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              Please wait…
            </div>
          ) : null}

          {phase === "success" ? (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                ...bannerStyle("success"),
              }}
            >
              {successMessage}
            </div>
          ) : null}

          {(phase === "missing_token" || phase === "error") && errorBlock.body ? (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                ...bannerStyle(errorBlock.kind === "already" ? "already" : "error"),
              }}
            >
              {errorBlock.body}
            </div>
          ) : null}

          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            <Link
              to="/login"
              style={{
                display: "block",
                textAlign: "center",
                border: "none",
                borderRadius: 14,
                padding: "12px 14px",
                fontWeight: 950,
                textDecoration: "none",
                background: "linear-gradient(135deg, rgba(37,99,235,1), rgba(29,78,216,1))",
                color: "#fff",
                boxShadow: "0 14px 34px rgba(37,99,235,0.28)",
              }}
            >
              Go to login
            </Link>
            <div style={{ textAlign: "center", fontSize: 13 }}>
              <Link to="/register" style={{ color: "#2563eb", fontWeight: 800 }}>
                Need to register?
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
