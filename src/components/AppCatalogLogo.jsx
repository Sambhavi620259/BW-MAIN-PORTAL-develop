import { useEffect, useRef, useState } from "react";
import { isUnusableMediaUrl, resolveMediaUrl } from "../utils/mediaUrl";

/**
 * Catalog app logo with uploads URL resolution and letter fallback.
 */
export default function AppCatalogLogo({
  src,
  name = "App",
  size = 40,
  className = "",
  style = {},
}) {
  const [broken, setBroken] = useState(false);
  const failedSrcRef = useRef("");
  const raw = String(src ?? "").trim();
  const resolved = isUnusableMediaUrl(raw) ? "" : resolveMediaUrl(raw);
  const letter = String(name || "A").trim().charAt(0).toUpperCase() || "A";
  const boxStyle = {
    width: size,
    height: size,
    borderRadius: 8,
    flexShrink: 0,
    ...style,
  };

  useEffect(() => {
    setBroken(false);
    failedSrcRef.current = "";
  }, [raw]);

  if (!resolved || broken) {
    return (
      <div
        className={className}
        style={{
          ...boxStyle,
          background: "#eff6ff",
          color: "#2563eb",
          display: "grid",
          placeItems: "center",
          fontWeight: 700,
          fontSize: Math.max(12, Math.round(size * 0.38)),
        }}
        aria-hidden
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      className={className}
      src={resolved}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{
        ...boxStyle,
        objectFit: "cover",
        background: "#f1f5f9",
      }}
      onError={() => {
        if (failedSrcRef.current === resolved) return;
        failedSrcRef.current = resolved;
        setBroken(true);
      }}
    />
  );
}
