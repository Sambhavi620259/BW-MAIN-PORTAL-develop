import { useNavigate } from "react-router-dom";
import { useBrand } from "../context/BrandContext";

export default function SupportComingSoon({ title = "Support" }) {
  const navigate = useNavigate();
  const { brand, defaultBrand } = useBrand();
  const companyName = brand?.name || defaultBrand?.name || "Bold and Wise";
  const logoUrl = brand?.logoUrl || defaultBrand?.logoUrl || "/logo.png";

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <img
            src={logoUrl}
            alt={companyName}
            style={{ width: 42, height: 42, borderRadius: 10, objectFit: "contain" }}
            onError={(e) => {
              e.currentTarget.src = defaultBrand?.logoUrl || "/logo.png";
            }}
          />
          <div>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>{companyName}</div>
            <div style={{ color: "#64748b", fontSize: 13 }}>{title}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          style={{
            border: "1px solid #dbe2ed",
            background: "#fff",
            padding: "10px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          ← Back to Dashboard
        </button>
      </header>

      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          border: "1px solid rgba(37, 99, 235, 0.08)",
          boxShadow: "0 4px 24px rgba(15, 23, 42, 0.06)",
          padding: 22,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.3px" }}>
          Coming soon
        </h1>
        <p style={{ margin: "8px 0 0", color: "#64748b" }}>
          This module will be enabled once the backend support APIs are available.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => navigate("/profile")}
            style={{
              border: "none",
              background: "#2563eb",
              color: "#fff",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            View Profile
          </button>
          <button
            type="button"
            onClick={() => navigate("/activity")}
            style={{
              border: "1px solid #dbe2ed",
              background: "#f8fafc",
              color: "#0f172a",
              padding: "10px 12px",
              borderRadius: 12,
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            View Activity
          </button>
        </div>
      </div>
    </div>
  );
}

