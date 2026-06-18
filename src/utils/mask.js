export function maskDocumentNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const keep = 4;
  const visible = raw.slice(-keep);
  const masked = raw.slice(0, Math.max(0, raw.length - keep)).replace(/./g, "•");
  return `${masked}${visible}`;
}

export function safeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

