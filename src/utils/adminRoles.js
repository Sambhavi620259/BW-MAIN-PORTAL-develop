/** Roles that may access the admin dashboard UI (backend must enforce on every /admin/** API). */
export const ADMIN_PANEL_ROLES = new Set(["ROLE_ADMIN", "ROLE_OWNER"]);

/** Roles allowed to send admin invites (OWNER may invite ADMIN or OWNER). */
export const ADMIN_INVITE_ROLES = new Set(["ROLE_ADMIN", "ROLE_OWNER"]);

export function normalizePanelRole(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return "";
  if (s.includes("ROLE_OWNER") || s === "OWNER") return "ROLE_OWNER";
  if (s.includes("ROLE_ADMIN") || s === "ADMIN") return "ROLE_ADMIN";
  if (s.includes("ROLE_USER") || s === "USER") return "ROLE_USER";
  if (s.startsWith("ROLE_")) return s;
  return "";
}

export function canAccessAdminPanel(role) {
  return ADMIN_PANEL_ROLES.has(normalizePanelRole(role));
}

export function canInviteAdmins(role) {
  return ADMIN_INVITE_ROLES.has(normalizePanelRole(role));
}

export function canInviteOwnerRole(inviterRole) {
  return normalizePanelRole(inviterRole) === "ROLE_OWNER";
}

/** Short API/UI role labels (no ROLE_ prefix). */
export const PANEL_ROLE_OPTIONS = ["USER", "ADMIN", "OWNER"];

export function toApiRole(value) {
  const normalized = normalizePanelRole(value);
  if (!normalized) return "USER";
  return normalized.replace(/^ROLE_/, "");
}

export function extractRowPanelRole(user) {
  return toApiRole(
    user?.panelRole ??
      user?.role ??
      user?.userRole ??
      user?.adminRole ??
      user?.type,
  );
}

export function isSameUserRow(actorProfile, targetRow) {
  const actorEmail = String(actorProfile?.email || actorProfile?.userEmail || "")
    .trim()
    .toLowerCase();
  const targetEmail = String(targetRow?.email || "")
    .trim()
    .toLowerCase();
  if (actorEmail && targetEmail && actorEmail !== "—" && actorEmail === targetEmail) {
    return true;
  }
  const actorId = String(actorProfile?.userId || actorProfile?.id || "").trim();
  const targetId = String(
    targetRow?.userId || targetRow?.id || targetRow?.user_id || "",
  ).trim();
  return Boolean(actorId && targetId && actorId === targetId);
}

export function countOwnersInRows(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => extractRowPanelRole(row) === "OWNER").length;
}

export function isLastOwnerTarget(targetRow, allRows) {
  if (extractRowPanelRole(targetRow) !== "OWNER") return false;
  return countOwnersInRows(allRows) <= 1;
}

/**
 * Roles the actor may pick in the dropdown for this target (forbidden options hidden).
 * Always includes the current role when the row is manageable.
 */
export function getAllowedTargetRoles(actorRole, currentRole, options = {}) {
  const { isSelf = false, isLastOwnerTarget = false } = options;
  const actor = normalizePanelRole(actorRole);
  const current = toApiRole(currentRole);

  if (isSelf) return [current];

  if (actor === "ROLE_ADMIN") {
    if (current === "OWNER") return ["OWNER"];
    if (current === "USER") return ["USER", "ADMIN"];
    if (current === "ADMIN") return ["ADMIN", "USER"];
    return [current];
  }

  if (actor === "ROLE_OWNER") {
    if (isLastOwnerTarget && current === "OWNER") return ["OWNER"];
    return [...PANEL_ROLE_OPTIONS];
  }

  return [current];
}

export function isRoleChangeAllowed(actorRole, fromRole, toRole, options = {}) {
  const from = toApiRole(fromRole);
  const to = toApiRole(toRole);
  if (from === to) return false;
  if (options.isSelf) return false;
  const allowed = getAllowedTargetRoles(actorRole, from, options);
  return allowed.includes(to);
}

export function canActorManageUserRole(actorRole, targetRow, allRows, actorProfile) {
  const actor = normalizePanelRole(actorRole);
  if (!ADMIN_PANEL_ROLES.has(actor)) return false;
  if (isSameUserRow(actorProfile, targetRow)) return false;
  if (actor === "ROLE_ADMIN" && extractRowPanelRole(targetRow) === "OWNER") {
    return false;
  }
  if (isLastOwnerTarget(targetRow, allRows)) return false;
  const current = extractRowPanelRole(targetRow);
  const allowed = getAllowedTargetRoles(actorRole, current, {
    isSelf: false,
    isLastOwnerTarget: isLastOwnerTarget(targetRow, allRows),
  });
  return allowed.length > 1;
}

export function getRoleDropdownDisabledReason(
  actorRole,
  targetRow,
  allRows,
  actorProfile,
) {
  if (isSameUserRow(actorProfile, targetRow)) {
    return "You cannot change your own role";
  }
  if (
    normalizePanelRole(actorRole) === "ROLE_ADMIN" &&
    extractRowPanelRole(targetRow) === "OWNER"
  ) {
    return "Only owners can change owner accounts";
  }
  if (isLastOwnerTarget(targetRow, allRows)) {
    return "The last owner cannot be demoted";
  }
  if (!canActorManageUserRole(actorRole, targetRow, allRows, actorProfile)) {
    return "Role change not permitted";
  }
  return "";
}

export function getRoleChangeConfirmation(fromRole, toRole, displayName) {
  const name = String(displayName || "this user").trim() || "this user";
  const from = toApiRole(fromRole);
  const to = toApiRole(toRole);
  if (to === "OWNER") {
    return `Promoting ${name} to OWNER grants full platform ownership, including inviting owners and changing all roles.`;
  }
  if (to === "ADMIN") {
    return `Promoting ${name} to ADMIN grants dashboard management access.`;
  }
  if (to === "USER" && (from === "ADMIN" || from === "OWNER")) {
    return `Demoting ${name} to USER removes admin dashboard access.`;
  }
  return `Change ${name}'s role from ${from} to ${to}?`;
}
