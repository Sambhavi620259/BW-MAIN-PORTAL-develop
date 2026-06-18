import { describe, expect, it } from "vitest";
import {
  canActorManageUserRole,
  extractRowPanelRole,
  getAllowedTargetRoles,
  getRoleChangeConfirmation,
  isLastOwnerTarget,
  isRoleChangeAllowed,
  isSameUserRow,
} from "./adminRoles";

describe("adminRoles role management", () => {
  const ownerRow = { id: "1", email: "owner@test.com", role: "OWNER" };
  const adminRow = { id: "2", email: "admin@test.com", role: "ADMIN" };
  const userRow = { id: "3", email: "user@test.com", role: "USER" };
  const allRows = [ownerRow, adminRow, userRow];

  it("extractRowPanelRole normalizes API shapes", () => {
    expect(extractRowPanelRole({ role: "ROLE_ADMIN" })).toBe("ADMIN");
    expect(extractRowPanelRole({ userRole: "owner" })).toBe("OWNER");
    expect(extractRowPanelRole({})).toBe("USER");
  });

  it("isSameUserRow matches email or id", () => {
    expect(
      isSameUserRow({ email: "admin@test.com" }, adminRow),
    ).toBe(true);
    expect(isSameUserRow({ userId: "3" }, userRow)).toBe(true);
    expect(isSameUserRow({ email: "other@test.com" }, userRow)).toBe(false);
  });

  it("ADMIN allowed targets exclude OWNER option", () => {
    expect(
      getAllowedTargetRoles("ROLE_ADMIN", "USER", { isSelf: false }),
    ).toEqual(["USER", "ADMIN"]);
    expect(
      getAllowedTargetRoles("ROLE_ADMIN", "ADMIN", { isSelf: false }),
    ).toEqual(["ADMIN", "USER"]);
    expect(
      getAllowedTargetRoles("ROLE_ADMIN", "OWNER", { isSelf: false }),
    ).toEqual(["OWNER"]);
  });

  it("OWNER can assign all roles except last owner demotion", () => {
    expect(
      getAllowedTargetRoles("ROLE_OWNER", "USER", { isSelf: false }),
    ).toEqual(["USER", "ADMIN", "OWNER"]);
    expect(
      getAllowedTargetRoles("ROLE_OWNER", "OWNER", {
        isSelf: false,
        isLastOwnerTarget: true,
      }),
    ).toEqual(["OWNER"]);
  });

  it("isRoleChangeAllowed enforces transition matrix", () => {
    expect(
      isRoleChangeAllowed("ROLE_ADMIN", "USER", "ADMIN", { isSelf: false }),
    ).toBe(true);
    expect(
      isRoleChangeAllowed("ROLE_ADMIN", "USER", "OWNER", { isSelf: false }),
    ).toBe(false);
    expect(
      isRoleChangeAllowed("ROLE_ADMIN", "OWNER", "USER", { isSelf: false }),
    ).toBe(false);
    expect(
      isRoleChangeAllowed("ROLE_OWNER", "ADMIN", "USER", { isSelf: false }),
    ).toBe(true);
    expect(
      isRoleChangeAllowed("ROLE_OWNER", "OWNER", "ADMIN", {
        isSelf: false,
        isLastOwnerTarget: true,
      }),
    ).toBe(false);
  });

  it("isLastOwnerTarget when single owner in list", () => {
    expect(isLastOwnerTarget(ownerRow, [ownerRow, userRow])).toBe(true);
    expect(
      isLastOwnerTarget(ownerRow, [ownerRow, { role: "OWNER" }, userRow]),
    ).toBe(false);
  });

  it("canActorManageUserRole blocks self and owner rows for admin", () => {
    const actor = { email: "admin@test.com", userId: "2" };
    const otherAdminActor = { email: "admin2@test.com", userId: "22" };
    expect(
      canActorManageUserRole("ROLE_ADMIN", userRow, allRows, actor),
    ).toBe(true);
    expect(
      canActorManageUserRole("ROLE_ADMIN", adminRow, allRows, otherAdminActor),
    ).toBe(true);
    expect(
      canActorManageUserRole("ROLE_ADMIN", ownerRow, allRows, actor),
    ).toBe(false);
    expect(
      canActorManageUserRole("ROLE_ADMIN", actor, allRows, actor),
    ).toBe(false);
    expect(
      canActorManageUserRole("ROLE_OWNER", ownerRow, [ownerRow], actor),
    ).toBe(false);
  });

  it("getRoleChangeConfirmation messages", () => {
    expect(getRoleChangeConfirmation("USER", "ADMIN", "Jane")).toContain(
      "dashboard management",
    );
    expect(getRoleChangeConfirmation("ADMIN", "USER", "Jane")).toContain(
      "removes admin",
    );
    expect(getRoleChangeConfirmation("USER", "OWNER", "Jane")).toContain(
      "full platform ownership",
    );
  });
});
