import { Link } from "react-router-dom";
import "./Logo.css";
import { useBrand } from "../context/BrandContext";

function LogoContent({ className = "", compact = false, showText = false }) {
  const { brand, defaultBrand } = useBrand();

  return (
    <span
      className={`logo-brand ${compact ? "logo-compact" : ""} ${className}`.trim()}
    >
      <img
        src={brand.logoUrl || defaultBrand.logoUrl}
        alt={brand.name}
        className="logo-img"
        onError={(e) => {
          e.target.src = defaultBrand.logoUrl;
        }}
      />
      <span className="logo-fallback">
        <svg
          className="logo-svg"
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 8L20 20L32 8V32L20 20L8 32V8Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M8 8L20 20L32 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </span>
      {showText && <span className="logo-tagline">{brand.name}</span>}
    </span>
  );
}

export default function Logo({
  className = "",
  to = "/",
  compact = false,
  showText = false,
}) {
  const content = (
    <LogoContent className={className} compact={compact} showText={showText} />
  );

  if (to) {
    return (
      <Link to={to} className="logo-link" style={{ display: "inline-flex" }}>
        {content}
      </Link>
    );
  }
  return content;
}
