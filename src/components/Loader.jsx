import React from "react";

const styles = {
  inline: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px",
  },
  fullScreen: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    zIndex: 9999,
  },
  spinner: {
    width: "36px",
    height: "36px",
    border: "3px solid #e0e0e0",
    borderTop: "3px solid #555",
    borderRadius: "50%",
    animation: "loader-spin 0.75s linear infinite",
  },
};

const keyframes = `
@keyframes loader-spin {
  to { transform: rotate(360deg); }
}
`;

let styleInjected = false;
function injectKeyframes() {
  if (styleInjected || typeof document === "undefined") return;
  const tag = document.createElement("style");
  tag.textContent = keyframes;
  document.head.appendChild(tag);
  styleInjected = true;
}

export default function Loader({ fullScreen = false }) {
  injectKeyframes();
  return (
    <div style={fullScreen ? styles.fullScreen : styles.inline}>
      <div style={styles.spinner} />
    </div>
  );
}
