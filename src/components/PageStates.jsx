export function PageLoading({ title = "Loading..." }) {
  return (
    <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
      {title}
    </div>
  );
}

export function PageError({ message = "Something went wrong.", onRetry }) {
  return (
    <div style={{ padding: 20, textAlign: "center", color: "#b91c1c" }}>
      <div style={{ marginBottom: 12 }}>{message}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#b91c1c",
            padding: "8px 12px",
            borderRadius: 12,
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function PageEmpty({ title = "Nothing to show.", subtitle = "" }) {
  return (
    <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
      <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 6 }}>
        {title}
      </div>
      {subtitle ? <div style={{ fontSize: 13 }}>{subtitle}</div> : null}
    </div>
  );
}

