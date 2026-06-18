import { toApiRole } from "../utils/adminRoles";

const ROLE_CLASS = {
  USER: "user",
  ADMIN: "admin",
  OWNER: "owner",
};

/**
 * Read-only role pill for table rows and user detail views.
 */
export default function AdminUserRoleBadge({ role, compact = false }) {
  const label = toApiRole(role);
  const slug = ROLE_CLASS[label] || "user";
  return (
    <span
      className={`users-role-badge users-role-badge--${slug}${compact ? " users-role-badge--compact" : ""}`}
    >
      {label}
    </span>
  );
}
