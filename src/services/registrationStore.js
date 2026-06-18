const REGISTERED_USERS_KEY = "ui-registered-users";

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readRegisteredUsers() {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(REGISTERED_USERS_KEY);
  if (!raw) return [];
  const parsed = safeParseJson(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeRegisteredUsers(users) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(users));
}

export function getRegisteredUsers() {
  return readRegisteredUsers();
}

export function upsertRegisteredUser(nextUser) {
  if (!nextUser || !nextUser.email) return;
  const users = readRegisteredUsers();
  const normalizedEmail = String(nextUser.email || "").trim().toLowerCase();
  const idx = users.findIndex(
    (u) => String(u?.email || "").trim().toLowerCase() === normalizedEmail,
  );
  const merged = { ...nextUser, email: normalizedEmail };
  const next = idx >= 0 ? users.map((u, i) => (i === idx ? merged : u)) : [...users, merged];
  writeRegisteredUsers(next);
}

export function clearRegisteredUsers() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REGISTERED_USERS_KEY);
}

